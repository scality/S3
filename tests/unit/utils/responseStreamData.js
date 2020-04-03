const assert = require('assert');
const httpMocks = require('node-mocks-http');
const { EventEmitter } = require('events');
const { errors, storage, s3routes } = require('arsenal');

const { cleanup, DummyRequestLogger } = require('../helpers');
const { config } = require('../../../lib/Config');
const { client, implName, data } = require('../../../lib/data/wrapper');
const kms = require('../../../lib/kms/wrapper');
const vault = require('../../../lib/auth/vault');
const locationStorageCheck =
    require('../../../lib/api/apiUtils/object/locationStorageCheck');
const metadata = require('../../../lib/metadata/wrapper');

const routesUtils = s3routes.routesUtils;
const { ds } = storage.data.inMemory.datastore;

const responseStreamData = routesUtils.responseStreamData;
const log = new DummyRequestLogger();
const owner = 'accessKey1canonicalID';
const namespace = 'default';
const bucketName = 'bucketname';
const postBody = Buffer.from('I am a body', 'utf8');
const errCode = null;
const overrideHeaders = {};
const resHeaders = {};
const dataStoreEntry = {
    value: postBody,
    keyContext: {
        bucketName,
        owner,
        namespace,
    },
};
const dataRetrievalParams = {
    client,
    implName,
    config,
    kms,
    metadata,
    locStorageCheckFn: locationStorageCheck,
    vault,
};

// TODO: Enable tests as a follow up. Technically tests were passing with node 4
// So this is potentially changing the tests to adapt to node 6
describe.skip('responseStreamData:', () => {
    beforeEach(() => {
        cleanup();
    });

    it('should stream full requested object data for one part object', done => {
        ds.push(null, dataStoreEntry);
        const dataLocations = [{
            key: 1,
            dataStore: 'mem',
        }];
        const response = httpMocks.createResponse({
            eventEmitter: EventEmitter,
        });
        response.on('end', () => {
            const data = response._getData();
            assert.strictEqual(data, postBody.toString());
            done();
        });
        return responseStreamData(errCode, overrideHeaders, resHeaders,
            dataLocations, dataRetrievalParams, response, null, log);
    });

    it('should stream full requested object data for two part object', done => {
        ds.push(null, dataStoreEntry, dataStoreEntry);
        const dataLocations = [
            {
                key: 1,
                dataStore: 'mem',
                start: 0,
                size: 11,
            },
            {
                key: 2,
                dataStore: 'mem',
                start: 11,
                size: 11,
            }];
        const response = httpMocks.createResponse({
            eventEmitter: EventEmitter,
        });
        response.on('end', () => {
            const data = response._getData();
            const doublePostBody = postBody.toString().concat(postBody);
            assert.strictEqual(data, doublePostBody);
            done();
        });
        return responseStreamData(errCode, overrideHeaders, resHeaders,
            dataLocations, dataRetrievalParams, response, null, log);
    });

    it('#334 non-regression test, destroy connection on error', done => {
        const dataLocations = [{
            key: 1,
            dataStore: 'mem',
            start: 0,
            size: 11,
        }];
        const prev = data.get;
        data.get = (objectGetInfo, response, log, cb) => {
            setTimeout(() => cb(errors.InternalError), 1000);
        };
        const response = httpMocks.createResponse({
            eventEmitter: EventEmitter,
        });
        let destroyed = false;
        response.destroy = () => {
            data.get = prev;
            destroyed = true;
        };
        response.on('end', () => {
            data.get = prev;
            if (!destroyed) {
                return done(new Error('end reached instead of destroying ' +
                    'connection'));
            }
            return done();
        });
        return responseStreamData(errCode, overrideHeaders, resHeaders,
            dataLocations, dataRetrievalParams, response, null, log);
    });
});
