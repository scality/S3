import async from 'async';
import { errors } from 'arsenal';
import assert from 'assert';
import Sproxy from 'sproxydclient';
import file from './file/backend';
import kinetic from './kinetic/backend';
import inMemory from './in_memory/backend';
import config from '../Config';
import MD5Sum from '../utilities/MD5Sum';
import kms from '../kms/wrapper';

let client;
let implName;

if (config.backends.data === 'mem') {
    client = inMemory;
    implName = 'mem';
} else if (config.backends.data === 'file') {
    client = file;
    implName = 'file';
} else if (config.backends.data === 'kinetic') {
    client = kinetic;
    implName = 'kinetic';
} else if (config.backends.data === 'scality') {
    client = new Sproxy({
        bootstrap: config.sproxyd.bootstrap,
        log: config.log,
        chordCos: config.sproxyd.chordCos,
    });
    implName = 'sproxyd';
}

/**
 * _retryDelete - Attempt to delete key again if it failed previously
 * @param {string} key - location of the object to delete
 * @param {object} log - Werelogs request logger
 * @param {number} count - keeps count of number of times function has been run
 * @param {function} cb - callback
 * @returns undefined and calls callback
 */
const MAX_RETRY = 2;

function _retryDelete(key, log, count, cb) {
    if (count > MAX_RETRY) {
        return cb(errors.InternalError);
    }
    return client.delete(key, log.getSerializedUids(), err => {
        if (err) {
            return _retryDelete(key, log, count + 1, cb);
        }
        return cb();
    });
}

const data = {
    put: (cipherBundle, value, valueSize, keyContext, log, cb) => {
        assert.strictEqual(typeof valueSize, 'number');
        log.debug('sending put to datastore', { implName, keyContext,
                                                method: 'put' });
        const hashedStream = new MD5Sum();
        value.pipe(hashedStream);

        let writeStream = hashedStream;
        if (cipherBundle && cipherBundle.cipher) {
            writeStream = cipherBundle.cipher;
            hashedStream.pipe(writeStream);
        }

        client.put(writeStream, valueSize, keyContext, log.getSerializedUids(),
           (err, key) => {
               if (err) {
                   log.error('error from datastore',
                             { error: err, implName });
                   return cb(errors.InternalError);
               }
               const dataRetrievalInfo = {
                   key,
                   dataStoreName: implName,
               };
               return cb(null, dataRetrievalInfo, hashedStream);
           });
    },

    get: (objectGetInfo, log, cb) => {
        // If objectGetInfo.key exists the md-model-version is 2 or greater.
        // Otherwise, the objectGetInfo is just the key string.
        const key = objectGetInfo.key ? objectGetInfo.key : objectGetInfo;
        const range = objectGetInfo.range;
        log.debug('sending get to datastore', { implName, key,
            range, method: 'get' });
        client.get(key, range, log.getSerializedUids(), (err, stream) => {
            if (err) {
                log.error('error from sproxyd', { error: err });
                return cb(errors.InternalError);
            }
            if (objectGetInfo.cipheredDataKey) {
                const serverSideEncryption = {
                    cryptoScheme: objectGetInfo.cryptoScheme,
                    masterKeyId: objectGetInfo.masterKeyId,
                    cipheredDataKey: Buffer.from(objectGetInfo.cipheredDataKey,
                                                'base64'),
                };
                const offset = objectGetInfo.range ? objectGetInfo.range[0] : 0;
                return kms.createDecipherBundle(
                    serverSideEncryption, offset, log,
                    (err, decipherBundle) => {
                        if (err) {
                            log.error('cannot get decipher bundle from kms', {
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
        const key = objectGetInfo.key ? objectGetInfo.key : objectGetInfo;
        log.debug('sending delete to datastore', {
            implName,
            key,
            method: 'delete',
        });
        _retryDelete(key, log, 0, err => {
            if (err) {
                log.error('error deleting object from datastore',
                    { error: err, key });
            }
            return callback(err);
        });
    },

    // It would be preferable to have an sproxyd batch delete route to
    // replace this
    batchDelete: (locations, log) => {
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
        client.healthcheck(log, (err, result) => {
            const respBody = {};
            if (err) {
                log.error(`error from ${implName}`, { error: err });
                respBody[implName] = {
                    error: err,
                };
                // respBody also returned so error is written to response
                return cb(err, respBody);
            }
            respBody[implName] = {
                code: result.statusCode,
                message: result.statusMessage,
            };
            return cb(null, respBody);
        });
    },
};

export default data;
