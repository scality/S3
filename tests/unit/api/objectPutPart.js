const crypto = require('crypto');
const assert = require('assert');
const async = require('async');
const { parseString } = require('xml2js');
const helpers = require('../helpers');
const DummyRequest = require('../DummyRequest');
const bucketPut = require('../../../lib/api/bucketPut').bucketPut;
const initiateMultipartUpload =
    require('../../../lib/api/initiateMultipartUpload');
const objectPutPart = require('../../../lib/api/objectPutPart');
const { ds } = require('../../../lib/data/in_memory/backend');

function createBucket(authInfo, log, cb) {
    const request = {
        namespace: 'default',
        bucketName: 'bucketname',
        url: '/',
        headers: {
            host: 'localhost',
        },
        post:
        '<CreateBucketConfiguration>' +
            '<LocationConstraint>scality-internal-mem</LocationConstraint>' +
        '</CreateBucketConfiguration>',
    };
    bucketPut(authInfo, request, log, cb);
}

function initiateMPU(authInfo, log, cb) {
    const request = {
        namespace: 'default',
        bucketName: 'bucketname',
        objectKey: 'objectKey',
        url: '/objectKey?uploads',
        headers: {
            host: 'localhost',
        },
    };
    initiateMultipartUpload(authInfo, request, log, cb);
}

function parseUploadID(res, cb) {
    parseString(res, (err, json) => {
        if (err) {
            return cb(err);
        }
        const uploadId = json.InitiateMultipartUploadResult.UploadId[0];
        return cb(null, uploadId);
    });
}

function putMPUPart(uploadId, authInfo, log, cb) {
    const body = Buffer.from('_', 'utf8');
    const request = new DummyRequest({
        namespace: 'default',
        bucketName: 'bucketname',
        objectKey: 'objectKey',
        url: `/objectKey?partNumber=1&uploadId=${uploadId}`,
        headers: {
            host: 'localhost',
        },
        query: {
            partNumber: '1',
            uploadId,
        },
        calculatedHash: crypto
            .createHash('md5')
            .update(body)
            .digest('hex'),
    }, body);
    objectPutPart(authInfo, request, undefined, log, cb);
}

describe('Multipart Upload API', () => {
    beforeEach(() => helpers.cleanup());

    describe('when metadata layer fails', () => {
        const authInfo = helpers.makeAuthInfo();
        const log = new helpers.DummyRequestLogger();

        beforeEach(done => {
            process.env.TEST_API_DATA = 'true';
            async.waterfall([
                next => createBucket(authInfo, log, next),
                (_, next) => initiateMPU(authInfo, log, next),
                (res, _, next) => parseUploadID(res, next),
                (uploadId, next) => putMPUPart(uploadId, authInfo, log, next),
            ], err => {
                process.env.TEST_API_DATA = 'false';
                if (err && !err.NoSuchBucket) {
                    return done(err);
                }
                return done();
            });
        });

        it('should cleanup orphaned data', () => {
            assert.strictEqual(ds.length, 2);
            assert.strictEqual(ds[0], undefined);
            assert.strictEqual(ds[1], undefined);
        });
    });
});
