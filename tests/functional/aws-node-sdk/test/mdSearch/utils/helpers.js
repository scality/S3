const assert = require('assert');
const async = require('async');

function _deleteVersionList(s3Client, versionList, bucket, callback) {
    if (versionList === undefined || versionList.length === 0) {
        return callback();
    }
    const params = { Bucket: bucket, Delete: { Objects: [] } };
    versionList.forEach(version => {
        params.Delete.Objects.push({
            Key: version.Key, VersionId: version.VersionId });
    });

    return s3Client.deleteObjects(params, callback);
}

const testUtils = {};

testUtils.runIfMongo = process.env.S3METADATA === 'mongodb' ?
    describe : describe.skip;

testUtils.runAndCheckSearch = (s3Client, bucketName, encodedSearch,
    testResult, done) => {
    const searchRequest = s3Client.listObjects({ Bucket: bucketName });
    searchRequest.on('build', () => {
        searchRequest.httpRequest.path =
        `${searchRequest.httpRequest.path}?search=${encodedSearch}`;
    });
    searchRequest.on('success', res => {
        if (testResult) {
            assert(res.data.Contents[0], 'should be Contents listed');
            assert.strictEqual(res.data.Contents[0].Key, testResult);
            assert.strictEqual(res.data.Contents.length, 1);
        } else {
            assert.strictEqual(res.data.Contents.length, 0);
        }
        return done();
    });
    searchRequest.on('error', err => {
        if (testResult) {
            assert.strictEqual(err.code, testResult.code);
            assert.strictEqual(err.message, testResult.message);
        }
        return done();
    });
    searchRequest.send();
};

testUtils.removeAllVersions = (s3Client, bucket, callback) => {
    async.waterfall([
        cb => s3Client.listObjectVersions({ Bucket: bucket }, cb),
        (data, cb) => _deleteVersionList(s3Client, data.DeleteMarkers, bucket,
            err => cb(err, data)),
        (data, cb) => _deleteVersionList(s3Client, data.Versions, bucket,
            err => cb(err, data)),
        (data, cb) => {
            if (data.IsTruncated) {
                const params = {
                    Bucket: bucket,
                    KeyMarker: data.NextKeyMarker,
                    VersionIdMarker: data.NextVersionIdMarker,
                };
                return this.removeAllVersions(params, cb);
            }
            return cb();
        },
    ], callback);
};

module.exports = testUtils;
