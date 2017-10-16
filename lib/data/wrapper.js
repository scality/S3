const async = require('async');
const { errors, s3middleware } = require('arsenal');
const PassThrough = require('stream').PassThrough;

const DataFileInterface = require('./file/backend');
const inMemory = require('./in_memory/backend').backend;
const multipleBackendGateway = require('./multipleBackendGateway');
const { config } = require('../Config');
const MD5Sum = s3middleware.MD5Sum;
const assert = require('assert');
const kms = require('../kms/wrapper');
const externalBackends = require('../../constants').externalBackends;
const constants = require('../../constants');
const locationHeader = constants.objectLocationConstraintHeader;

let CdmiData;
try {
    CdmiData = require('cdmiclient').CdmiData;
} catch (err) {
    CdmiData = null;
}

let client;
let implName;

if (config.backends.data === 'mem') {
    client = inMemory;
    implName = 'mem';
} else if (config.backends.data === 'file') {
    client = new DataFileInterface();
    implName = 'file';
} else if (config.backends.data === 'multiple') {
    client = multipleBackendGateway;
    implName = 'multipleBackends';
} else if (config.backends.data === 'cdmi') {
    if (!CdmiData) {
        throw new Error('Unauthorized backend');
    }

    client = new CdmiData({
        path: config.cdmi.path,
        host: config.cdmi.host,
        port: config.cdmi.port,
    });
    implName = 'cdmi';
}

/**
 * _retryDelete - Attempt to delete key again if it failed previously
 * @param { string | object } objectGetInfo - either string location of object
 *      to delete or object containing info of object to delete
 * @param {object} log - Werelogs request logger
 * @param {number} count - keeps count of number of times function has been run
 * @param {function} cb - callback
 * @returns undefined and calls callback
 */
const MAX_RETRY = 2;

function _retryDelete(objectGetInfo, log, count, cb) {
    if (count > MAX_RETRY) {
        return cb(errors.InternalError);
    }
    return client.delete(objectGetInfo, log.getSerializedUids(), err => {
        if (err) {
            log.error('delete error from datastore',
                      { error: err, implName, moreRetries: 'yes' });
            return _retryDelete(objectGetInfo, log, count + 1, cb);
        }
        return cb();
    });
}

function _put(cipherBundle, value, valueSize,
              keyContext, backendInfo, log, cb) {
    assert.strictEqual(typeof valueSize, 'number');
    log.debug('sending put to datastore', { implName, keyContext,
        method: 'put' });
    let hashedStream = null;
    if (value) {
        hashedStream = new MD5Sum();
        value.pipe(hashedStream);
    }

    if (implName === 'multipleBackends') {
        // Need to send backendInfo to client.put and
        // client.put will provide dataRetrievalInfo so no
        // need to construct here
        /* eslint-disable no-param-reassign */
        keyContext.cipherBundle = cipherBundle;
        return client.put(hashedStream,
               valueSize, keyContext, backendInfo, log.getSerializedUids(),
               (err, dataRetrievalInfo) => {
                   if (err) {
                       log.error('put error from datastore',
                                 { error: err, implName });
                       return cb(errors.InternalError);
                   }
                   return cb(null, dataRetrievalInfo, hashedStream);
               });
    }
    /* eslint-enable no-param-reassign */

    let writeStream = hashedStream;
    if (cipherBundle && cipherBundle.cipher) {
        writeStream = cipherBundle.cipher;
        hashedStream.pipe(writeStream);
    }

    return client.put(writeStream, valueSize, keyContext,
                      log.getSerializedUids(), (err, key) => {
                          if (err) {
                              log.error('put error from datastore',
                                        { error: err, implName });
                              return cb(errors.InternalError);
                          }
                          const dataRetrievalInfo = {
                              key,
                              dataStoreName: implName,
                          };
                          return cb(null, dataRetrievalInfo, hashedStream);
                      });
}

const data = {
    put: (cipherBundle, value, valueSize, keyContext, backendInfo, log, cb) => {
        _put(cipherBundle, value, valueSize, keyContext, backendInfo, log,
             (err, dataRetrievalInfo, hashedStream) => {
                 if (err) {
                     return cb(err);
                 }
                 if (hashedStream) {
                     if (hashedStream.completedHash) {
                         return cb(null, dataRetrievalInfo, hashedStream);
                     }
                     hashedStream.on('hashed', () => {
                         hashedStream.removeAllListeners('hashed');
                         return cb(null, dataRetrievalInfo, hashedStream);
                     });
                     return undefined;
                 }
                 return cb(null, dataRetrievalInfo);
             });
    },

    get: (objectGetInfo, response, log, cb) => {
        // If objectGetInfo.key exists the md-model-version is 2 or greater.
        // Otherwise, the objectGetInfo is just the key string.
        const objGetInfo = (implName === 'sproxyd' || implName === 'cdmi') ?
            objectGetInfo.key : objectGetInfo;
        const range = objectGetInfo.range;
        log.debug('sending get to datastore', { implName,
            key: objectGetInfo.key, range, method: 'get' });
        // We need to use response as a writtable stream for AZURE GET
        if (response) {
            objGetInfo.response = response;
        }
        client.get(objGetInfo, range, log.getSerializedUids(),
            (err, stream) => {
                if (err) {
                    log.error('get error from datastore',
                              { error: err, implName });
                    return cb(errors.InternalError);
                }
                if (objectGetInfo.cipheredDataKey) {
                    const serverSideEncryption = {
                        cryptoScheme: objectGetInfo.cryptoScheme,
                        masterKeyId: objectGetInfo.masterKeyId,
                        cipheredDataKey: Buffer.from(
                            objectGetInfo.cipheredDataKey, 'base64'),
                    };
                    const offset = objectGetInfo.range ?
                        objectGetInfo.range[0] : 0;
                    return kms.createDecipherBundle(
                        serverSideEncryption, offset, log,
                        (err, decipherBundle) => {
                            if (err) {
                                log.error('cannot get decipher bundle ' +
                                    'from kms', {
                                        method: 'data.wrapper.data.get',
                                    });
                                return cb(err);
                            }
                            stream.pipe(decipherBundle.decipher);
                            return cb(null, decipherBundle.decipher);
                        });
                }
                return cb(null, stream);
            });
    },

    delete: (objectGetInfo, log, cb) => {
        const callback = cb || log.end;
        // If objectGetInfo.key exists the md-model-version is 2 or greater.
        // Otherwise, the objectGetInfo is just the key string.
        const objGetInfo = (implName === 'sproxyd' || implName === 'cdmi') ?
            objectGetInfo.key : objectGetInfo;
        log.trace('sending delete to datastore', {
            implName,
            key: objectGetInfo.key,
            method: 'delete',
        });
        _retryDelete(objGetInfo, log, 0, err => {
            if (err) {
                log.error('delete error from datastore',
                    { error: err, key: objectGetInfo.key, moreRetries: 'no' });
            }
            return callback(err);
        });
    },

    // It would be preferable to have an sproxyd batch delete route to
    // replace this
    batchDelete: (locations, requestMethod, newObjDataStoreName, log) => {
        // TODO: The method of persistence of sproxy delete key will
        // be finalized; refer Issue #312 for the discussion. In the
        // meantime, we at least log the location of the data we are
        // about to delete before attempting its deletion.
        /* eslint-disable camelcase */
        const skipBackend = externalBackends;
        /* eslint-enable camelcase */
        const isSkipBackend = (locations[0] && locations[0].dataStoreType) ?
            skipBackend[locations[0].dataStoreType] : false;
        const isMatchingBackends = locations[0] ?
            locations[0].dataStoreName === newObjDataStoreName : false;
        // This check is done because on a PUT request to AWS, if the object
        // already exists on AWS, the existing object should not be deleted,
        // which is the functionality for all other backends
        // TODO: update for mpu and object copy
        if (requestMethod === 'PUT' && isSkipBackend && isMatchingBackends) {
            return;
        }
        log.trace('initiating batch delete', {
            keys: locations,
            implName,
            method: 'batchDelete',
        });
        async.eachLimit(locations, 5, (loc, next) => {
            data.delete(loc, log, next);
        },
        err => {
            if (err) {
                log.error('batch delete failed', { error: err });
            } else {
                log.trace('batch delete successfully completed');
            }
            log.end();
        });
    },

    switch: newClient => {
        client = newClient;
        return client;
    },

    checkHealth: (log, cb) => {
        if (!client.healthcheck) {
            const defResp = {};
            defResp[implName] = { code: 200, message: 'OK' };
            return cb(null, defResp);
        }
        return client.healthcheck(log, (err, result) => {
            let respBody = {};
            if (err) {
                log.error(`error from ${implName}`, { error: err });
                respBody[implName] = {
                    error: err,
                };
                // error returned as null so async parallel doesn't return
                // before all backends are checked
                return cb(null, respBody);
            }
            if (implName === 'multipleBackends') {
                respBody = result;
                return cb(null, respBody);
            }
            respBody[implName] = {
                code: result.statusCode,
                message: result.statusMessage,
            };
            return cb(null, respBody);
        });
    },

    getDiskUsage: (log, cb) => {
        if (!client.getDiskUsage) {
            log.debug('returning empty disk usage as fallback', { implName });
            return cb(null, {});
        }
        return client.getDiskUsage(log.getSerializedUids(), cb);
    },

    _dataCopyPut: (serverSideEncryption, stream, part,
      dataStoreContext, destBackendInfo, log, cb) => {
        if (serverSideEncryption) {
            return kms.createCipherBundle(
            serverSideEncryption,
            log, (err, cipherBundle) => {
                if (err) {
                    log.debug('error getting cipherBundle');
                    return cb(errors.InternalError);
                }
                return data.put(cipherBundle, stream,
                part.size,
                dataStoreContext, destBackendInfo,
                log, (error, partRetrievalInfo) => {
                    if (error) {
                        return cb(error);
                    }
                    const partResult = {
                        key: partRetrievalInfo.key,
                        dataStoreName: partRetrievalInfo
                            .dataStoreName,
                        dataStoreType: partRetrievalInfo
                            .dataStoreType,
                        start: part.start,
                        size: part.size,
                        cryptoScheme: cipherBundle
                            .cryptoScheme,
                        cipheredDataKey: cipherBundle
                            .cipheredDataKey,
                    };
                    return cb(null, partResult);
                });
            });
        }
        return data.put(null, stream, part.size,
        dataStoreContext, destBackendInfo,
        log, (error, partRetrievalInfo) => {
            if (error) {
                return cb(error);
            }
            const partResult = {
                key: partRetrievalInfo.key,
                dataStoreType: partRetrievalInfo
                    .dataStoreType,
                dataStoreName: partRetrievalInfo.
                    dataStoreName,
                dataStoreETag: part.dataStoreETag,
                start: part.start,
                size: part.size,
            };
            return cb(null, partResult);
        });
    },

    /**
     * copyObject - copy object
     * @param {object} request - request object
     * @param {string} sourceLocationConstraintType -
     * source locationContraint type (azure, aws_s3, ...)
     * @param {string} sourceLocationConstraintName -
     * source locationContraint name (aws-test, azuretest, ...)
     * @param {object} storeMetadataParams - metadata information of the
     * source object
     * @param {array} dataLocator - source object metadata location(s)
     * NOTE: for Azure and AWS data backend this array
     * @param {object} dataStoreContext - information of the
     * destination object
     * dataStoreContext.bucketName: destination bucket name,
     * dataStoreContext.owner: owner,
     * dataStoreContext.namespace: request namespace,
     * dataStoreContext.objectKey: destination object key name,
     * @param {BackendInfo} destBackendInfo - Instance of BackendInfo:
     * Represents the info necessary to evaluate which data backend to use
     * on a data put call.
     * @param {object} sourceBucketMD - bucket metadata of the source
     * @param {object} destBucketMD - bucket metadata of the destination
     * @param {object} log - Werelogs request logger
     * @param {function} cb - callback
     * @returns {function} cb - callback
     */
    copyObject: (request, sourceLocationConstraintType,
      sourceLocationConstraintName, storeMetadataParams, dataLocator,
      dataStoreContext, destBackendInfo, sourceBucketMD, destBucketMD, log,
      cb) => {
        // NOTE: Server side copy should only be allowed:
        // 1) if source object and destination object are both on aws or both
        // on azure.
        // 2) if azure to azure, must be the same storage account since Azure
        // copy outside of an account is async
        // 3) if the source bucket is not an encrypted bucket and the
        // destination bucket is not an encrypted bucket (unless the copy
        // is all within the same bucket).
        const locationTypeMatch = request.headers[locationHeader] ?
        config.getLocationConstraintType(sourceLocationConstraintName) ===
        config.getLocationConstraintType(request.headers[locationHeader])
        : true;
        const sourceBucketName = sourceBucketMD.getName();
        const destBucketName = request.bucketName;
        const isSameBucket = sourceBucketName === destBucketName;
        console.log('destBucketMD!!!', destBucketMD);
        const serverSideEncryption = destBucketMD.getServerSideEncryption();
        const bucketNotEncrypted = serverSideEncryption
        === sourceBucketMD.getServerSideEncryption() === null;
        if (locationTypeMatch && (isSameBucket || bucketNotEncrypted) &&
        (sourceLocationConstraintType === 'aws_s3' ||
        (sourceLocationConstraintType === 'azure' && config.isSameAzureAccount(
        sourceLocationConstraintName, request.headers[locationHeader])))) {
            const location = storeMetadataParams
            .metaHeaders[locationHeader];
            const objectGetInfo = dataLocator[0];
            const externalSourceKey = objectGetInfo.key;
            return client.copyObject(request, location,
            externalSourceKey, sourceLocationConstraintName, destBucketMD, log,
            (error, objectRetrievalInfo) => {
                if (error) {
                    return cb(error);
                }
                const putResult = {
                    key: objectRetrievalInfo.key,
                    dataStoreName: objectRetrievalInfo.
                        dataStoreName,
                    dataStoreType: objectRetrievalInfo.
                        dataStoreType,
                    size: storeMetadataParams.size,
                    dataStoreETag: objectGetInfo.dataStoreETag,
                    start: objectGetInfo.start,
                };
                const putResultArr = [putResult];
                return cb(null, putResultArr);
            });
        }

        // dataLocator is an array.  need to get and put all parts
        // For now, copy 1 part at a time. Could increase the second
        // argument here to increase the number of parts
        // copied at once.
        return async.mapLimit(dataLocator, 1,
            // eslint-disable-next-line prefer-arrow-callback
            function copyPart(part, copyCb) {
                if (part.dataStoreType === 'azure') {
                    const passThrough = new PassThrough();
                    return async.parallel([
                        parallelCb => data.get(part, passThrough, log, err =>
                          parallelCb(err)),
                        parallelCb => {
                            data._dataCopyPut(serverSideEncryption, passThrough,
                            part, dataStoreContext, destBackendInfo, log,
                            parallelCb);
                        },
                    ], (err, res) => {
                        if (err) {
                            return copyCb(err);
                        }
                        return copyCb(null, res[1]);
                    });
                }
                return data.get(part, null, log, (err, stream) => {
                    if (err) {
                        return copyCb(err);
                    }
                    return data._dataCopyPut(serverSideEncryption, stream,
                    part, dataStoreContext, destBackendInfo, log, copyCb);
                });
            }, (err, results) => {
                if (err) {
                    log.debug('error transferring data from source',
                    { error: err });
                    return cb(err);
                }
                return cb(null, results);
            });
    },
};

module.exports = data;
