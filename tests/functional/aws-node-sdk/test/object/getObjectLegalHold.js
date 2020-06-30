const assert = require('assert');
const Promise = require('bluebird');

const withV4 = require('../support/withV4');
const BucketUtility = require('../../lib/utility/bucket-util');
const checkError = require('../../lib/utility/checkError');
const removeObjectLock = require('../../lib/utility/objectLock-util');

const removeLockPromise = Promise.promisify(removeObjectLock);

const bucket = 'mock-bucket-lock';
const unlockedBucket = 'mock-bucket-no-lock';
const key = 'mock-object-legalhold';
const keyNoHold = 'mock-object-no-legalhold';

describe('GET object legal hold', () => {
    withV4(sigCfg => {
        const bucketUtil = new BucketUtility('default', sigCfg);
        const s3 = bucketUtil.s3;
        const otherAccountBucketUtility = new BucketUtility('lisa', {});
        const otherAccountS3 = otherAccountBucketUtility.s3;
        let versionId;

        beforeEach(() => {
            process.stdout.write('Putting buckets and objects\n');
            return s3.createBucketPromise(
                { Bucket: bucket, ObjectLockEnabledForBucket: true })
            .then(() => s3.createBucketPromise({ Bucket: unlockedBucket }))
            .then(() => s3.putObjectPromise({ Bucket: unlockedBucket, Key: key }))
            .then(() => s3.putObjectPromise({ Bucket: bucket, Key: keyNoHold }))
            .then(() => s3.putObjectPromise({ Bucket: bucket, Key: key }))
            .then(res => {
                versionId = res.VersionId;
                process.stdout.write('Putting object legal hold\n');
                return s3.putObjectLegalHoldPromise({
                    Bucket: bucket,
                    Key: key,
                    LegalHold: { Status: 'ON' },
                });
            })
            .catch(err => {
                process.stdout.write('Error in beforeEach\n');
                throw err;
            });
        });

        afterEach(() => {
            process.stdout.write('Removing object lock\n');
            return removeLockPromise([{ bucket, key, versionId }])
            .then(() => {
                process.stdout.write('Emptying and deleting buckets\n');
                return bucketUtil.empty(bucket);
            })
            .then(() => bucketUtil.empty(unlockedBucket))
            .then(() => bucketUtil.deleteMany([bucket, unlockedBucket]))
            .catch(err => {
                process.stdout.write('Error in afterEach');
                throw err;
            });
        });

        it('should return AccessDenied getting legal hold with another account',
            done => {
                otherAccountS3.getObjectLegalHold({
                    Bucket: bucket,
                    Key: key,
                }, err => {
                    checkError(err, 'AccessDenied', 403);
                    done();
                });
            });

        it('should return NoSuchKey error if key does not exist', done => {
            s3.getObjectLegalHold({
                Bucket: bucket,
                Key: 'thiskeydoesnotexist',
            }, err => {
                checkError(err, 'NoSuchKey', 404);
                done();
            });
        });

        it('should return NoSuchVersion error if version does not exist', done => {
            s3.getObjectLegalHold({
                Bucket: bucket,
                Key: key,
                VersionId: '000000000000',
            }, err => {
                checkError(err, 'NoSuchVersion', 404);
                done();
            });
        });

        it('should return MethodNotAllowed if object version is delete marker', done => {
            s3.deleteObject({ Bucket: bucket, Key: key }, (err, res) => {
                assert.ifError(err);
                s3.getObjectLegalHold({
                    Bucket: bucket,
                    Key: key,
                    VersionId: res.VersionId,
                }, err => {
                    checkError(err, 'MethodNotAllowed', 405);
                    done();
                });
            });
        });

        it('should return InvalidRequest error getting legal hold of object ' +
            'inside object lock disabled bucket', done => {
            s3.getObjectLegalHold({
                Bucket: unlockedBucket,
                Key: key,
            }, err => {
                checkError(err, 'InvalidRequest', 400);
                done();
            });
        });

        it('should return NoSuchObjectLockConfiguration if no legal hold set', done => {
            s3.getObjectLegalHold({
                Bucket: bucket,
                Key: keyNoHold,
            }, err => {
                checkError(err, 'NoSuchObjectLockConfiguration', 404);
                done();
            });
        });

        it('should get object legal hold', done => {
            s3.getObjectLegalHold({
                Bucket: bucket,
                Key: key,
            }, (err, res) => {
                assert.ifError(err);
                assert.deepStrictEqual(res.LegalHold, { Status: 'ON' });
                removeObjectLock([{ bucket, key, versionId }], done);
            });
        });
    });
});
