const assert = require('assert');
const { errors } = require('arsenal');
const { S3 } = require('aws-sdk');

const getConfig = require('../support/config');
const BucketUtility = require('../../lib/utility/bucket-util');

const bucket = 'lifecycletestbucket';

// Check for the expected error response code and status code.
function assertError(err, expectedErr, cb) {
    if (expectedErr === null) {
        assert.strictEqual(err, null, `expected no error but got '${err}'`);
    } else {
        assert.strictEqual(err.code, expectedErr, 'incorrect error response ' +
            `code: should be '${expectedErr}' but got '${err.code}'`);
        assert.strictEqual(err.statusCode, errors[expectedErr].code,
            'incorrect error status code: should be 400 but got ' +
            `'${err.statusCode}'`);
    }
    cb();
}

describe('aws-sdk test get bucket lifecycle', () => {
    let s3;
    let otherAccountS3;

    before(done => {
        const config = getConfig('default', { signatureVersion: 'v4' });
        s3 = new S3(config);
        otherAccountS3 = new BucketUtility('lisa', {}).s3;
        return done();
    });

    it('should return NoSuchBucket error if bucket does not exist', done => {
        s3.getBucketLifecycleConfiguration({ Bucket: bucket }, err =>
            assertError(err, 'NoSuchBucket', done));
    });

    describe('config rules', () => {
        beforeEach(done => s3.createBucket({ Bucket: bucket }, done));

        afterEach(done => s3.deleteBucket({ Bucket: bucket }, done));

        it('should return AccessDenied if user is not bucket owner', done => {
            otherAccountS3.getBucketLifecycleConfiguration({ Bucket: bucket },
            err => assertError(err, 'AccessDenied', done));
        });

        it('should return NoSuchLifecycleConfiguration error if no lifecycle ' +
        'put to bucket', done => {
            s3.getBucketLifecycleConfiguration({ Bucket: bucket }, err => {
                assertError(err, 'NoSuchLifecycleConfiguration', done);
            });
        });

        it('should get bucket lifecycle config with top-level prefix', done =>
            s3.putBucketLifecycleConfiguration({
                Bucket: bucket,
                LifecycleConfiguration: {
                    Rules: [{
                        ID: 'test-id',
                        Status: 'Enabled',
                        Prefix: '',
                        Expiration: { Days: 1 },
                    }],
                },
            }, err => {
                assert.equal(err, null, `Err putting lifecycle config: ${err}`);
                s3.getBucketLifecycleConfiguration({ Bucket: bucket },
                (err, res) => {
                    assert.equal(err, null, 'Error getting lifecycle config: ' +
                        `${err}`);
                    assert.strictEqual(res.Rules.length, 1);
                    assert.deepStrictEqual(res.Rules[0], {
                        Expiration: { Days: 1 },
                        ID: 'test-id',
                        Prefix: '',
                        Status: 'Enabled',
                        Transitions: [],
                        NoncurrentVersionTransitions: [],
                    });
                    done();
                });
            }));

        it('should get bucket lifecycle config with filter prefix', done =>
            s3.putBucketLifecycleConfiguration({
                Bucket: bucket,
                LifecycleConfiguration: {
                    Rules: [{
                        ID: 'test-id',
                        Status: 'Enabled',
                        Filter: { Prefix: '' },
                        Expiration: { Days: 1 },
                    }],
                },
            }, err => {
                assert.equal(err, null, `Err putting lifecycle config: ${err}`);
                s3.getBucketLifecycleConfiguration({ Bucket: bucket },
                (err, res) => {
                    assert.equal(err, null, 'Error getting lifecycle config: ' +
                        `${err}`);
                    assert.strictEqual(res.Rules.length, 1);
                    assert.deepStrictEqual(res.Rules[0], {
                        Expiration: { Days: 1 },
                        ID: 'test-id',
                        Filter: { Prefix: '' },
                        Status: 'Enabled',
                        Transitions: [],
                        NoncurrentVersionTransitions: [],
                    });
                    done();
                });
            }));

        it('should get bucket lifecycle config with filter prefix and tags',
        done =>
            s3.putBucketLifecycleConfiguration({
                Bucket: bucket,
                LifecycleConfiguration: {
                    Rules: [{
                        ID: 'test-id',
                        Status: 'Enabled',
                        Filter: {
                            And: {
                                Prefix: '',
                                Tags: [
                                    {
                                        Key: 'key',
                                        Value: 'value',
                                    },
                                ],
                            },
                        },
                        Expiration: { Days: 1 },
                    }],
                },
            }, err => {
                assert.equal(err, null, `Err putting lifecycle config: ${err}`);
                s3.getBucketLifecycleConfiguration({ Bucket: bucket },
                (err, res) => {
                    assert.equal(err, null, 'Error getting lifecycle config: ' +
                        `${err}`);
                    assert.strictEqual(res.Rules.length, 1);
                    assert.deepStrictEqual(res.Rules[0], {
                        Expiration: { Days: 1 },
                        ID: 'test-id',
                        Filter: {
                            And: {
                                Prefix: '',
                                Tags: [
                                    {
                                        Key: 'key',
                                        Value: 'value',
                                    },
                                ],
                            },
                        },
                        Status: 'Enabled',
                        Transitions: [],
                        NoncurrentVersionTransitions: [],
                    });
                    done();
                });
            }));
    });
});
