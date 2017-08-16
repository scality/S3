const assert = require('assert');
const { errors } = require('arsenal');

const { bucketPut } = require('../../../lib/api/bucketPut');
const { cleanup, DummyRequestLogger, makeAuthInfo } = require('../helpers');
const objectPut = require('../../../lib/api/objectPut');
const objectHead = require('../../../lib/api/objectHead');
const DummyRequest = require('../DummyRequest');

const log = new DummyRequestLogger();
const canonicalID = 'accessKey1';
const authInfo = makeAuthInfo(canonicalID);
const namespace = 'default';
const bucketName = 'bucketname';
const postBody = Buffer.from('I am a body', 'utf8');
const correctMD5 = 'be747eb4b75517bf6b3cf7c5fbb62f3a';
const incorrectMD5 = 'fkjwelfjlslfksdfsdfsdfsdfsdfsdj';
const objectName = 'objectName';
const date = new Date();
const laterDate = date.setMinutes(date.getMinutes() + 30);
const earlierDate = date.setMinutes(date.getMinutes() - 30);
const testPutBucketRequest = {
    bucketName,
    namespace,
    headers: {},
    url: `/${bucketName}`,
};
const userMetadataKey = 'x-amz-meta-test';
const userMetadataValue = 'some metadata';

let testPutObjectRequest;

describe('objectHead API', () => {
    beforeEach(() => {
        cleanup();
        testPutObjectRequest = new DummyRequest({
            bucketName,
            namespace,
            objectKey: objectName,
            headers: { 'x-amz-meta-test': userMetadataValue },
            url: `/${bucketName}/${objectName}`,
            calculatedHash: correctMD5,
        }, postBody);
    });

    it('should return NotModified if request header ' +
       'includes "if-modified-since" and object ' +
       'not modified since specified time', done => {
        const testGetRequest = {
            bucketName,
            namespace,
            objectKey: objectName,
            headers: { 'if-modified-since': laterDate },
            url: `/${bucketName}/${objectName}`,
        };

        bucketPut(authInfo, testPutBucketRequest, log, () => {
            objectPut(authInfo, testPutObjectRequest, undefined, log,
                (err, resHeaders) => {
                    assert.strictEqual(resHeaders.ETag, `"${correctMD5}"`);
                    objectHead(authInfo, testGetRequest, log, err => {
                        assert.deepStrictEqual(err, errors.NotModified);
                        done();
                    });
                });
        });
    });

    it('should return PreconditionFailed if request header ' +
       'includes "if-unmodified-since" and object has ' +
       'been modified since specified time', done => {
        const testGetRequest = {
            bucketName,
            namespace,
            objectKey: objectName,
            headers: { 'if-unmodified-since': earlierDate },
            url: `/${bucketName}/${objectName}`,
        };

        bucketPut(authInfo, testPutBucketRequest, log, () => {
            objectPut(authInfo, testPutObjectRequest, undefined, log,
                (err, resHeaders) => {
                    assert.strictEqual(resHeaders.ETag, `"${correctMD5}"`);
                    objectHead(authInfo, testGetRequest, log, err => {
                        assert.deepStrictEqual(err,
                            errors.PreconditionFailed);
                        done();
                    });
                });
        });
    });

    it('should return PreconditionFailed if request header ' +
       'includes "if-match" and ETag of object ' +
       'does not match specified ETag', done => {
        const testGetRequest = {
            bucketName,
            namespace,
            objectKey: objectName,
            headers: { 'if-match': incorrectMD5 },
            url: `/${bucketName}/${objectName}`,
        };

        bucketPut(authInfo, testPutBucketRequest, log, () => {
            objectPut(authInfo, testPutObjectRequest, undefined, log,
                (err, resHeaders) => {
                    assert.strictEqual(resHeaders.ETag, `"${correctMD5}"`);
                    objectHead(authInfo, testGetRequest, log, err => {
                        assert.deepStrictEqual(err,
                            errors.PreconditionFailed);
                        done();
                    });
                });
        });
    });

    it('should return NotModified if request header ' +
       'includes "if-none-match" and ETag of object does ' +
       'match specified ETag', done => {
        const testGetRequest = {
            bucketName,
            namespace,
            objectKey: objectName,
            headers: { 'if-none-match': correctMD5 },
            url: `/${bucketName}/${objectName}`,
        };

        bucketPut(authInfo, testPutBucketRequest, log, () => {
            objectPut(authInfo, testPutObjectRequest, undefined, log,
                (err, resHeaders) => {
                    assert.strictEqual(resHeaders.ETag, `"${correctMD5}"`);
                    objectHead(authInfo, testGetRequest, log, err => {
                        assert.deepStrictEqual(err, errors.NotModified);
                        done();
                    });
                });
        });
    });

    it('should get the object metadata', done => {
        const testGetRequest = {
            bucketName,
            namespace,
            objectKey: objectName,
            headers: {},
            url: `/${bucketName}/${objectName}`,
        };

        bucketPut(authInfo, testPutBucketRequest, log, () => {
            objectPut(authInfo, testPutObjectRequest, undefined, log,
                (err, resHeaders) => {
                    assert.strictEqual(resHeaders.ETag, `"${correctMD5}"`);
                    objectHead(authInfo, testGetRequest, log, (err, res) => {
                        assert.strictEqual(res[userMetadataKey],
                            userMetadataValue);
                        assert
                        .strictEqual(res.ETag, `"${correctMD5}"`);
                        done();
                    });
                });
        });
    });
});
