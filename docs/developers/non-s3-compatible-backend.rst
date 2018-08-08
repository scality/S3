==========================================================
Adding support for data backends not supporting the S3 API
==========================================================

These backends abstract the complexity of multiple APIs to let users
work on a single common namespace across multiple clouds.

This documents aims at introducing you to the right files in
Cloudserver (the Zenko stack's subcomponent in charge of API
translation, among other things) to add support to your own backend of
choice.

General configuration
~~~~~~~~~~~~~~~~~~~~~

There are a number of constants and environment variables to define to support a
new data backend; here is a list and where to find them:

:file:`/constants.js`
---------------------

 * give your backend type a name, as part of the `externalBackends` object;
 * specify whether versioning is implemented, as part of the
   `versioningNotImplemented` object;

:file:`/lib/Config.js`
----------------------

 * this is where you should put common utility functions, like the ones to parse
   the location object from `locationConfig.json`;
 * make sure you define environment variables (like `GCP_SERVICE_EMAIL` as we'll
   use those internally for the CI to test against the real remote backend;

:file:`/lib/data/external/{{backendName}}Client.js`
---------------------------------------------------

 * this file is where you'll instantiate your backend client; this should be a
   class with a constructor taking the config object built in `/lib/Config.js` as
   parameter;
 * over time, you may need some utility functions which we've defined in the
   folder `/api/apiUtils`, and in the file `/lib/data/external/utils`;

:file:`/lib/data/external/utils.js`
-----------------------------------

 * make sure to add options for `sourceLocationConstraintType` to be equal to
   the name you gave your backend in :file:`/constants.js`;

:file:`/lib/data/external/{{BackendName}}_lib/`
-----------------------------------------------

 * this folder is where you'll put the functions needed for supporting your
   backend; keep your files as atomic as possible;

:file:`/tests/locationConfig/locationConfigTests.json`
------------------------------------------------------

 * this file is where you'll create location profiles to be used by your
   functional tests;

:file:`/lib/data/locationConstraintParser.js`
---------------------------------------------

 * this is where you'll instantiate your client if the operation the end user
   sent effectively writes to your backend; everything happens inside the
   function `parseLC()`; you should add a condition that executes if
   `locationObj.type` is the name of your backend (that you defined in
   `constants.js`), and instantiates a client of yours. See pseudocode below,
   assuming location type name is `ztore`:


.. code-block:: js
   :linenos:
   :emphasize-lines: 12

    (...) //<1>
    const ZtoreClient = require('./external/ZtoreClient');
    const { config } = require('../Config'); //<1>

    function parseLC(){ //<1>
    (...) //<1>
        Object.keys(config.locationConstraints).forEach(location => { //<1>
            const locationObj = config.locationConstraints[location]; //<1>
            (...) //<1>
            if (locationObj.type === 'ztore' {
                const ztoreEndpoint = config.getZtoreEndpoint(location);
                const ztoreCredentials = config.getZtoreCredentials(location); //<2>
                clients[location] = new ZtoreClient({
                    ztoreEndpoint,
                    ztoreCredentials,
                    ztoreBucketname: locationObj.details.ztoreBucketName,
                    bucketMatch:  locationObj.details.BucketMatch,
                    dataStoreName: location,
                }); //<3>
                clients[location].clientType = 'ztore';
            });
            (...) //<1>
        });
    }


1. Code that is already there
2. You may need more utility functions depending on your backend specs
3. You may have more fields required in your constructor object depending on
   your backend specs

Operation of type PUT
~~~~~~~~~~~~~~~~~~~~~

PUT routes are usually where people get started, as it's the easiest to check!
Simply go on your remote backend console and you'll be able to see whether your
object actually went up in the cloud...

These are the files you'll need to edit:

:file:`/lib/data/external/{{BackendName}}Client.js`
---------------------------------------------------

- the function that is going to call your `put()` function is also called
  `put()`, and it's defined in `/lib/data/multipleBackendGateway.js`;
- define a function with signature like
  `put(stream, size, keyContext, reqUids, callback)`; this is worth exploring a
  bit more as these parameters are the same for all backends:
  //TODO: generate this from jsdoc

 - `stream`: the stream of data you want to put in the cloud; if you're
   unfamiliar with node.js streams, we suggest you start training, as we use
   them a lot !

 - `size`: the size of the object you're trying to put;

 - `keyContext`: an object with metadata about the operation; common entries are
   `namespace`, `buckerName`, `owner`, `cipherBundle`, and `tagging`; if these
   are not sufficient for your integration, contact us to get architecture
   validation before adding new entries;

 - `reqUids`: the request unique ID used for logging;

 - `callback`: your function's callback (should handle errors);

:file:`/lib/data/external/{{backendName}}_lib/`
-----------------------------------------------

- this is where you should put all utility functions for your PUT operation, and
  then import then in :file:`/lib/data/external/{{BackendName}}Client.js`, to keep
  your code clean;

:file:`tests/functional/aws-node-sdk/test/multipleBackend/put/put{{BackendName}}js`
-----------------------------------------------------------------------------------

- every contribution should come with thorough functional tests, showing
  nominal context gives expected behaviour, and error cases are handled in a way
  that is standard with the backend (including error messages and code);
- the ideal setup is if you simulate your backend locally, so as not to be
  subjected to network flakiness in the CI; however, we know there might not be
  mockups available for every client; if that is the case of your backend, you
  may test against the "real" endpoint of your data backend;

:file:`tests/functional/aws-node-sdk/test/multipleBackend/utils.js`
-------------------------------------------------------------------

- where you'll define a constant for your backend location matching your
  :file:`/tests/locationConfig/locationConfigTests.json`
- depending on your backend, the sample `keys[]` and associated made up objects
  may not work for you (if your backend's key format is different, for example);
  if that is the case, you should add a custom `utils.get{{BackendName}}keys()`
  function returning ajusted `keys[]` to your tests.

Operation of type GET
~~~~~~~~~~~~~~~~~~~~~

GET routes are easy to test after PUT routes are implemented, hence why we're
covering them second.

These are the files you'll need to edit:

:file:`/lib/data/external/{{BackendName}}Client.js`
---------------------------------------------------

- the function that is going to call your `get()` function is also called
  `get()`, and it's defined in `/lib/data/multipleBackendGateway.js`;
- define a function with signature like
  `get(objectGetInfo, range, reqUids, callback)`; this is worth exploring a
  bit more as these parameters are the same for all backends:

//TODO: generate this from jsdoc

 - `objectGetInfo`: a dictionary with two entries: `key`, the object key in the
   data store, and `client`, the data store name;

 - `range`: the range of bytes you will get, for "get-by-range" operations (we
   recommend you do simple GETs first, and then look at this);

 - `reqUids`: the request unique ID used for logging;

 - `callback`: your function's callback (should handle errors);

:file:`/lib/data/external/{{backendName}}_lib/`
-----------------------------------------------

- this is where you should put all utility functions for your GET operation, and
  then import then in `/lib/data/external/{{BackendName}}Client.js`, to keep
  your code clean;

:file:`tests/functional/aws-node-sdk/test/multipleBackend/get/get{{BackendName}}js`
-----------------------------------------------------------------------------------

- every contribution should come with thorough functional tests, showing
  nominal context gives expected behaviour, and error cases are handled in a way
  that is standard with the backend (including error messages and code);
- the ideal setup is if you simulate your backend locally, so as not to be
  subjected to network flakiness in the CI; however, we know there might not be
  mockups available for every client; if that is the case of your backend, you
  may test against the "real" endpoint of your data backend;

:file:`tests/functional/aws-node-sdk/test/multipleBackend/utils.js`
-------------------------------------------------------------------

.. note:: You should need this section if you have followed the tutorial in order
          (that is, if you have covered the PUT operation already)

- where you'll define a constant for your backend location matching your
  :file:`/tests/locationConfig/locationConfigTests.json`
- depending on your backend, the sample `keys[]` and associated made up objects
  may not work for you (if your backend's key format is different, for example);
  if that is the case, you should add a custom `utils.get{{BackendName}}keys()`

Operation of type DELETE
~~~~~~~~~~~~~~~~~~~~~~~~

DELETE routes are easy to test after PUT routes are implemented, and they are
similar to GET routes in our implementation, hence why we're covering them
third.

These are the files you'll need to edit:

:file:`/lib/data/external/{{BackendName}}Client.js`
---------------------------------------------------

- the function that is going to call your `delete()` function is also called
  `delete()`, and it's defined in :file:`/lib/data/multipleBackendGateway.js`;
- define a function with signature like
  `delete(objectGetInfo, reqUids, callback)`; this is worth exploring a
  bit more as these parameters are the same for all backends:

//TODO: generate this from jsdoc
 * `objectGetInfo`: a dictionary with two entries: `key`, the object key in the
   data store, and `client`, the data store name;
 * `reqUids`: the request unique ID used for logging;
 * `callback`: your function's callback (should handle errors);

:file:`/lib/data/external/{{backendName}}_lib/`
-----------------------------------------------

- this is where you should put all utility functions for your DELETE operation,
  and then import then in `/lib/data/external/{{BackendName}}Client.js`, to keep
  your code clean;

:file:`tests/functional/aws-node-sdk/test/multipleBackend/delete/delete{{BackendName}}js`
-----------------------------------------------------------------------------------------

- every contribution should come with thorough functional tests, showing
  nominal context gives expected behaviour, and error cases are handled in a way
  that is standard with the backend (including error messages and code);
- the ideal setup is if you simulate your backend locally, so as not to be
  subjected to network flakiness in the CI; however, we know there might not be
  mockups available for every client; if that is the case of your backend, you
  may test against the "real" endpoint of your data backend;

:file:`tests/functional/aws-node-sdk/test/multipleBackend/utils.js`
-------------------------------------------------------------------

.. note:: You should need this section if you have followed the
          tutorial in order (that is, if you have covered the PUT operation
          already)

- where you'll define a constant for your backend location matching your
  :file:`/tests/locationConfig/locationConfigTests.json`
- depending on your backend, the sample `keys[]` and associated made up objects
  may not work for you (if your backend's key format is different, for example);
  if that is the case, you should add a custom `utils.get{{BackendName}}keys()`

Operation of type HEAD
~~~~~~~~~~~~~~~~~~~~~~

HEAD routes are very similar to DELETE routes in our implementation, hence why
we're covering them fourth.

These are the files you'll need to edit:

:file:`/lib/data/external/{{BackendName}}Client.js`
---------------------------------------------------

- the function that is going to call your `head()` function is also called
  `head()`, and it's defined in :file:`/lib/data/multipleBackendGateway.js`;
- define a function with signature like
  `head(objectGetInfo, reqUids, callback)`; this is worth exploring a
  bit more as these parameters are the same for all backends:

// TODO:: generate this from jsdoc

 * `objectGetInfo`: a dictionary with two entries: `key`, the object key in the
   data store, and `client`, the data store name;
 * `reqUids`: the request unique ID used for logging;
 * `callback`: your function's callback (should handle errors);

:file:`/lib/data/external/{{backendName}}_lib/`
-----------------------------------------------

- this is where you should put all utility functions for your HEAD operation,
  and then import then in :file:`/lib/data/external/{{BackendName}}Client.js`, to keep
  your code clean;

:file:`tests/functional/aws-node-sdk/test/multipleBackend/get/get{{BackendName}}js`
-----------------------------------------------------------------------------------

- every contribution should come with thorough functional tests, showing
  nominal context gives expected behaviour, and error cases are handled in a way
  that is standard with the backend (including error messages and code);
- the ideal setup is if you simulate your backend locally, so as not to be
  subjected to network flakiness in the CI; however, we know there might not be
  mockups available for every client; if that is the case of your backend, you
  may test against the "real" endpoint of your data backend;

:file:`tests/functional/aws-node-sdk/test/multipleBackend/utils.js`
-------------------------------------------------------------------

.. note:: You should need this section if you have followed the tutorial in order
          (that is, if you have covered the PUT operation already)

- where you'll define a constant for your backend location matching your
  :file:`/tests/locationConfig/locationConfigTests.json`
- depending on your backend, the sample `keys[]` and associated made up objects
  may not work for you (if your backend's key format is different, for example);
  if that is the case, you should add a custom `utils.get{{BackendName}}keys()`

Healthcheck
~~~~~~~~~~~

Healtchecks are used to make sure failure to write to a remote cloud is due to
a problem on that remote cloud, an not on Zenko's side.
This is usually done by trying to create a bucket that already exists, and
making sure you get the expected answer.

These are the files you'll need to edit:

:file:`/lib/data/external/{{BackendName}}Client.js`
---------------------------------------------------

- the function that is going to call your `healthcheck()` function is called
  `checkExternalBackend()` and it's defined in
  :file:`/lib/data/multipleBackendGateway.js`; you will need to add your own;
- your healtcheck function should get `location` as a parameter, which is an
  object comprising:`

 * `reqUids`: the request unique ID used for logging;
 * `callback`: your function's callback (should handle errors);

:file:`/lib/data/external/{{backendName}}_lib/{{backendName}}_create_bucket.js`
-------------------------------------------------------------------------------

- this is where you should write the function performing the actual bucket
  creation;

:file:`/lib/data/external/{{backendName}}_lib/utils.js`
-------------------------------------------------------

- add an object named per your backend's name to the `backendHealth` dictionary,
  with proper `response` and `time` entries;

:file:`lib/data/multipleBackendGateway.js`
------------------------------------------

- edit the `healthcheck` function to add your location's array, and call your
  healthcheck; see pseudocode below for a sample implementation, provided your
  backend name is `ztore`


.. code-block:: js
   :linenos:

    (...) //<1>

        healthcheck: (flightCheckOnStartUp, log, callback) => { //<1>
            (...) //<1>
            const ztoreArray = []; //<2>
            async.each(Object.keys(clients), (location, cb) => { //<1>
                (...) //<1>
                } else if (client.clientType === 'ztore' {
                    ztoreArray.push(location); //<3>
                    return cb();
                }
            (...) //<1>
            multBackendResp[location] = { code: 200, message: 'OK' }; //<1>
            return cb();
        }, () => { //<1>
            async.parallel([
                (...) //<1>
                next => checkExternalBackend( //<4>
                    clients, ztoreArray, 'ztore', flightCheckOnStartUp,
                    externalBackendHealthCheckInterval, next),
            ] (...) //<1>
            });
            (...) //<1>
        });
    }

1. Code that is already there
2. The array that will store all locations of type 'ztore'
3. Where you add locations of type 'ztore' to the array
4. Where you actually call the healthcheck function on all 'ztore' locations

Multipart upload (MPU)
~~~~~~~~~~~~~~~~~~~~~~

This is the final part to supporting a new backend! MPU is far from
the easiest subject, but you've come so far it shouldn't be a problem.

These are the files you'll need to edit:

:file:`/lib/data/external/{{BackendName}}Client.js`
---------------------------------------------------

You'll be creating four functions with template signatures:

- `createMPU(Key, metaHeaders, bucketName, websiteRedirectHeader, contentType,
  cacheControl, contentDisposition, contentEncoding, log, callback)` will
  initiate the multi part upload process; now, here, all parameters are
  metadata headers except for:

 * `Key`, the key id for the final object (collection of all parts);
 * `bucketName`, the name of the bucket to which we will do an MPU;
 * `log`, the logger;

- `uploadPart(request, streamingV4Params, stream, size, key, uploadId, partNumber, bucketName, log, callback)`
   will be called for each part; the parameters can be explicited as follow:

 * `request`, the request object for putting the part;
 * `streamingV4Params`, parameters for auth V4 parameters against S3;
 * `stream`, the node.js readable stream used to put the part;
 * `size`, the size of the part;
 * `key`, the key of the object;
 * `uploadId`, multipart upload id string;
 * `partNumber`, the number of the part in this MPU (ordered);
 * `bucketName`, the name of the bucket to which we will do an MPU;
 * `log`, the logger;

- `completeMPU(jsonList, mdInfo, key, uploadId, bucketName, log, callback)` will
   end the MPU process once all parts are uploaded; parameters can be explicited
   as follows:

 * `jsonList`, user-sent list of parts to include in final mpu object;
 * `mdInfo`, object containing 3 keys: storedParts, mpuOverviewKey, and
   splitter;
 * `key`, the key of the object;
 * `uploadId`, multipart upload id string;
 * `bucketName`, name of bucket;
 * `log`, logger instance:

- `abortMPU(key, uploadId, bucketName, log, callback)` will handle errors, and
  make sure that all parts that may have been uploaded will be deleted if the
  MPU ultimately fails; the parameters are:

 * `key`, the key of the object;
 * `uploadId`, multipart upload id string;
 * `bucketName`, name of bucket;
 * `log`, logger instance.

:file:`/lib/api/objectPutPart.js`
---------------------------------

- you'll need to add your backend type in appropriate sections (simply look for
  other backends already implemented).

:file:`/lib/data/external/{{backendName}}_lib/`
-----------------------------------------------

- this is where you should put all utility functions for your MPU operations,
  and then import then in :file:`/lib/data/external/{{BackendName}}Client.js`, to keep
  your code clean;

:file:`lib/data/multipleBackendGateway.js`
------------------------------------------

- edit the `createMPU` function to add your location type, and call your
  `createMPU()`; see pseudocode below for a sample implementation, provided your
  backend name is `ztore`

.. code-block:: javascript
   :linenos:

    (...) //<1>
        createMPU:(key, metaHeaders, bucketName, websiteRedirectHeader, //<1>
         location, contentType, cacheControl, contentDisposition,
         contentEncoding, log, cb) => {
            const client = clients[location]; //<1>
            if (client.clientType === 'aws_s3') { //<1>
                return client.createMPU(key, metaHeaders, bucketName,
                websiteRedirectHeader, contentType, cacheControl,
                contentDisposition, contentEncoding, log, cb);
            } else if (client.clientType === 'ztore') { //<2>
                return client.createMPU(key, metaHeaders, bucketName,
                  websiteRedirectHeader, contentType, cacheControl,
                  contentDisposition, contentEncoding, log, cb);
            }
            return cb();
        };
    (...) //<1>

1. Code that is already there
2. Where the `createMPU()` of your client is actually called

Add functional tests
~~~~~~~~~~~~~~~~~~~~

* :file:`tests/functional/aws-node-sdk/test/multipleBackend/initMPU/{{BackendName}}InitMPU.js`
* :file:`tests/functional/aws-node-sdk/test/multipleBackend/listParts/{{BackendName}}ListPart.js`
* :file:`tests/functional/aws-node-sdk/test/multipleBackend/mpuAbort/{{BackendName}}AbortMPU.js`
* :file:`tests/functional/aws-node-sdk/test/multipleBackend/mpuComplete/{{BackendName}}CompleteMPU.js`
* :file:`tests/functional/aws-node-sdk/test/multipleBackend/mpuParts/{{BackendName}}UploadPart.js`

Adding support in Orbit, Zenko's UI for simplified Multi Cloud Management
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This can only be done by our core developers' team. Once your backend
integration is merged, you may open a feature request on the
`Zenko repository`_, and we will
get back to you after we evaluate feasability and maintainability.

.. _Zenko repository: https://www.github.com/scality/Zenko/issues/new
