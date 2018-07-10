const assert = require('assert');
const async = require('async');

const withV4 = require('../support/withV4');
const BucketUtility = require('../../lib/utility/bucket-util');

const { removeAllVersions } = require('../../lib/utility/versioning-util');

const bucket = `versioning-bucket-${Date.now()}`;

function _assertResultElements(entry) {
    const elements = [
        'LastModified',
        'ETag',
        'Size',
        'Owner',
        'StorageClass',
    ];
    elements.forEach(elem => {
        assert.notStrictEqual(entry[elem], undefined,
            `Expected ${elem} in result but did not find it`);
        if (elem === 'Owner') {
            assert(entry.Owner.ID, 'Expected Owner ID but did not find it');
            assert(entry.Owner.DisplayName,
                'Expected Owner DisplayName but did not find it');
        }
    });
}

describe('listObject - Delimiter master', function testSuite() {
    this.timeout(600000);

    withV4(sigCfg => {
        const bucketUtil = new BucketUtility('default', sigCfg);
        const s3 = bucketUtil.s3;

        // setup test
        before(done => {
            s3.createBucket({ Bucket: bucket }, done);
        });

        // delete bucket after testing
        after(done => {
            removeAllVersions({ Bucket: bucket }, err => {
                if (err) {
                    return done(err);
                }
                return s3.deleteBucket({ Bucket: bucket }, err => {
                    assert.strictEqual(err, null,
                        `Error deleting bucket: ${err}`);
                    return done();
                });
            });
        });

        let versioning = false;

        const objects = [
            { name: 'notes/summer/august/1.txt', value: 'foo', isNull: true },
            { name: 'notes/year.txt', value: 'foo', isNull: true },
            { name: 'notes/yore.rs', value: 'foo', isNull: true },
            { name: 'notes/zaphod/Beeblebrox.txt', value: 'foo', isNull: true },
            { name: 'Pâtisserie=中文-español-English', value: 'foo' },
            { name: 'Pâtisserie=中文-español-English', value: 'bar' },
            { name: 'notes/spring/1.txt', value: 'qux' },
            { name: 'notes/spring/1.txt', value: 'foo' },
            { name: 'notes/spring/1.txt', value: 'bar' },
            { name: 'notes/spring/2.txt', value: 'foo' },
            { name: 'notes/spring/2.txt', value: null },
            { name: 'notes/spring/march/1.txt', value: 'foo' },
            { name: 'notes/spring/march/1.txt', value: 'bar', isNull: true },
            { name: 'notes/summer/1.txt', value: 'foo' },
            { name: 'notes/summer/1.txt', value: 'bar' },
            { name: 'notes/summer/2.txt', value: 'bar' },
            { name: 'notes/summer/4.txt', value: null },
            { name: 'notes/summer/4.txt', value: null },
            { name: 'notes/summer/4.txt', value: null },
            { name: 'notes/summer/444.txt', value: null },
            { name: 'notes/summer/44444.txt', value: null },
        ];

        it('put objects inside bucket', done => {
            async.eachSeries(objects, (obj, next) => {
                async.waterfall([
                    next => {
                        if (!versioning && obj.isNull !== true) {
                            const params = {
                                Bucket: bucket,
                                VersioningConfiguration: {
                                    Status: 'Enabled',
                                },
                            };
                            versioning = true;
                            return s3.putBucketVersioning(params, err =>
                                next(err));
                        } else if (versioning && obj.isNull === true) {
                            const params = {
                                Bucket: bucket,
                                VersioningConfiguration: {
                                    Status: 'Suspended',
                                },
                            };
                            versioning = false;
                            return s3.putBucketVersioning(params, err =>
                                next(err));
                        }
                        return next();
                    },
                    next => {
                        if (obj.value === null) {
                            return s3.deleteObject({
                                Bucket: bucket,
                                Key: obj.name,
                            }, function test(err) {
                                const headers = this.httpResponse.headers;
                                assert.strictEqual(
                                    headers['x-amz-delete-marker'], 'true');
                                return next(err);
                            });
                        }
                        return s3.putObject({
                            Bucket: bucket,
                            Key: obj.name,
                            Body: obj.value,
                        }, err => next(err));
                    },
                ], err => next(err));
            }, err => done(err));
        });

        [
            {
                name: 'basic listing',
                params: {},
                expectedResult: [
                    'Pâtisserie=中文-español-English',
                    'notes/spring/1.txt',
                    'notes/spring/march/1.txt',
                    'notes/summer/1.txt',
                    'notes/summer/2.txt',
                    'notes/summer/august/1.txt',
                    'notes/year.txt',
                    'notes/yore.rs',
                    'notes/zaphod/Beeblebrox.txt',
                ],
                commonPrefix: [],
                isTruncated: false,
                nextMarker: undefined,
            },
            {
                name: 'with valid marker',
                params: { Marker: 'notes/summer/1.txt' },
                expectedResult: [
                    'notes/summer/2.txt',
                    'notes/summer/august/1.txt',
                    'notes/year.txt',
                    'notes/yore.rs',
                    'notes/zaphod/Beeblebrox.txt',
                ],
                commonPrefix: [],
                isTruncated: false,
                nextMarker: undefined,
            },
            {
                name: 'with bad marker',
                params: { Marker: 'zzzz', Delimiter: '/' },
                expectedResult: [],
                commonPrefix: [],
                isTruncated: false,
                nextMarker: undefined,
            },
            {
                name: 'with maxKeys',
                params: { MaxKeys: 3 },
                expectedResult: [
                    'Pâtisserie=中文-español-English',
                    'notes/spring/1.txt',
                    'notes/spring/march/1.txt',
                ],
                commonPrefix: [],
                isTruncated: true,
                nextMarker: undefined,
            },
            {
                name: 'with big maxKeys',
                params: { MaxKeys: 15000 },
                expectedResult: [
                    'Pâtisserie=中文-español-English',
                    'notes/spring/1.txt',
                    'notes/spring/march/1.txt',
                    'notes/summer/1.txt',
                    'notes/summer/2.txt',
                    'notes/summer/august/1.txt',
                    'notes/year.txt',
                    'notes/yore.rs',
                    'notes/zaphod/Beeblebrox.txt',
                ],
                commonPrefix: [],
                isTruncated: false,
                nextMarker: undefined,
            },
            {
                name: 'with delimiter',
                params: { Delimiter: '/' },
                expectedResult: [
                    'Pâtisserie=中文-español-English',
                ],
                commonPrefix: ['notes/'],
                isTruncated: false,
                nextMarker: undefined,
            },
            {
                name: 'with long delimiter',
                params: { Delimiter: 'notes/summer' },
                expectedResult: [
                    'Pâtisserie=中文-español-English',
                    'notes/spring/1.txt',
                    'notes/spring/march/1.txt',
                    'notes/year.txt',
                    'notes/yore.rs',
                    'notes/zaphod/Beeblebrox.txt',
                ],
                commonPrefix: ['notes/summer'],
                isTruncated: false,
                nextMarker: undefined,
            },
            {
                name: 'bad marker and good prefix',
                params: {
                    Delimiter: '/',
                    Prefix: 'notes/summer/',
                    Marker: 'notes/summer0',
                },
                expectedResult: [],
                commonPrefix: [],
                isTruncated: false,
                nextMarker: undefined,
            },
            {
                name: 'delimiter and prefix (related to #147)',
                params: { Delimiter: '/', Prefix: 'notes/' },
                expectedResult: [
                    'notes/year.txt',
                    'notes/yore.rs',
                ],
                commonPrefix: [
                    'notes/spring/',
                    'notes/summer/',
                    'notes/zaphod/',
                ],
                isTruncated: false,
                nextMarker: undefined,
            },
            {
                name: 'delimiter, prefix and marker (related to #147)',
                params: {
                    Delimiter: '/',
                    Prefix: 'notes/',
                    Marker: 'notes/year.txt',
                },
                expectedResult: ['notes/yore.rs'],
                commonPrefix: ['notes/zaphod/'],
                isTruncated: false,
                nextMarker: undefined,
            },
            {
                name: 'all parameters 1/5',
                params: {
                    Delimiter: '/',
                    Prefix: 'notes/',
                    Marker: 'notes/',
                    MaxKeys: 1,
                },
                expectedResult: [],
                commonPrefix: ['notes/spring/'],
                isTruncated: true,
                nextMarker: 'notes/spring/',
            },
            {
                name: 'all parameters 2/5',
                params: {
                    Delimiter: '/',
                    Prefix: 'notes/',
                    Marker: 'notes/spring/',
                    MaxKeys: 1,
                },
                expectedResult: [],
                commonPrefix: ['notes/summer/'],
                isTruncated: true,
                nextMarker: 'notes/summer/',
            },
            {
                name: 'all parameters 3/5',
                params: {
                    Delimiter: '/',
                    Prefix: 'notes/',
                    Marker: 'notes/summer/',
                    MaxKeys: 1,
                },
                expectedResult: ['notes/year.txt'],
                commonPrefix: [],
                isTruncated: true,
                nextMarker: 'notes/year.txt',
            },
            {
                name: 'all parameters 4/5',
                params: {
                    Delimiter: '/',
                    Prefix: 'notes/',
                    Marker: 'notes/year.txt',
                    MaxKeys: 1,
                },
                expectedResult: ['notes/yore.rs'],
                commonPrefix: [],
                isTruncated: true,
                nextMarker: 'notes/yore.rs',
            },
            {
                name: 'all parameters 5/5',
                params: {
                    Delimiter: '/',
                    Prefix: 'notes/',
                    Marker: 'notes/yore.rs',
                    MaxKeys: 1,
                },
                expectedResult: [],
                commonPrefix: ['notes/zaphod/'],
                isTruncated: false,
                nextMarker: undefined,
            },
        ].forEach(test => {
            it(test.name, done => {
                const expectedResult = test.expectedResult;
                s3.listObjects(Object.assign({ Bucket: bucket }, test.params),
                    (err, res) => {
                        if (err) {
                            return done(err);
                        }
                        res.Contents.forEach(result => {
                            if (!expectedResult
                                .find(key => key === result.Key)) {
                                throw new Error('listing fail, ' +
                                `unexpected key ${result.Key}`);
                            }
                            _assertResultElements(result);
                        });
                        res.CommonPrefixes.forEach(cp => {
                            if (!test.commonPrefix
                                .find(item => item === cp.Prefix)) {
                                throw new Error('listing fail, ' +
                                `unexpected prefix ${cp.Prefix}`);
                            }
                        });
                        assert.strictEqual(res.IsTruncated, test.isTruncated);
                        assert.strictEqual(res.NextMarker, test.nextMarker);
                        return done();
                    });
            });
        });
    });
});
