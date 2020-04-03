Metadata Search Documentation
=============================

Description
-----------

This feature enables metadata search to be performed on the metadata of objects
stored in Zenko.

Requirements
------------

* MongoDB

Design
------

The Metadata Search feature expands on the existing :code:`GET Bucket` S3 API by
enabling users to conduct metadata searches by adding the custom Zenko query
string parameter, :code:`search`. The :code:`search` parameter is structured as a pseudo
SQL WHERE clause, and supports basic SQL operators. For example:
:code:`"A=1 AND B=2 OR C=3"` (complex queries can be built using nesting
operators, :code:`(` and :code:`)`).

The search process is as follows:

* Zenko receives a :code:`GET` request.

  .. code::

    # regular getBucket request
    GET /bucketname HTTP/1.1
    Host: 127.0.0.1:8000
    Date: Wed, 18 Oct 2018 17:50:00 GMT
    Authorization: authorization string

    # getBucket versions request
    GET /bucketname?versions HTTP/1.1
    Host: 127.0.0.1:8000
    Date: Wed, 18 Oct 2018 17:50:00 GMT
    Authorization: authorization string

    # search getBucket request
    GET /bucketname?search=key%3Dsearch-item HTTP/1.1
    Host: 127.0.0.1:8000
    Date: Wed, 18 Oct 2018 17:50:00 GMT
    Authorization: authorization string

* If the request does *not* contain the :code:`search` query parameter, Zenko performs
  a normal bucket listing and returns an XML result containing the list of
  objects.
* If the request *does* contain the :code:`search` query parameter, Zenko parses and
  validates the search string.

  - If the search string is invalid, Zenko returns an :code:`InvalidArgument` error.

    .. code::

      <?xml version=\"1.0\" encoding=\"UTF-8\"?>
      <Error>
        <Code>InvalidArgument</Code>
        <Message>Invalid sql where clause sent as search query</Message>
        <Resource></Resource>
        <RequestId>d1d6afc64345a8e1198e</RequestId>
      </Error>

  - If the search string is valid, Zenko parses it and generates an abstract
    syntax tree (AST). The AST is then passed to the MongoDB backend to be
    used as the query filter for retrieving objects from a bucket that
    satisfies the requested search conditions. Zenko parses the filtered
    results and returns them as the response.

Metadata search results have the same structure as a :code:`GET Bucket` response:

.. code:: xml

  <?xml version="1.0" encoding="UTF-8"?>
  <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <Name>bucketname</Name>
      <Prefix/>
      <Marker/>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
          <Key>objectKey</Key>
          <LastModified>2018-04-19T18:31:49.426Z</LastModified>
          <ETag>&quot;d41d8cd98f00b204e9800998ecf8427e&quot;</ETag>
          <Size>0</Size>
          <Owner>
              <ID>79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be</ID>
              <DisplayName>Bart</DisplayName>
          </Owner>
          <StorageClass>STANDARD</StorageClass>
      </Contents>
      <Contents>
          ...
      </Contents>
  </ListBucketResult>

Performing Metadata Searches with Zenko
---------------------------------------

You can perform metadata searches by:

+ Using the :code:`search_bucket` tool in the
  `Scality/S3 <https://github.com/scality/S3>`_ GitHub repository.
+ Creating a signed HTTP request to Zenko in your preferred programming
  language.

Using the S3 Tool
+++++++++++++++++

After cloning the `Scality/S3 <https://github.com/scality/S3>`_ GitHub repository
and installing the necessary dependencies, run the following command in the S3
project’s root directory to access the search tool:

.. code::

  node bin/search_bucket

This generates the following output:

.. code::

    Usage: search_bucket [options]

    Options:

      -V, --version                 output the version number
      -a, --access-key <accessKey>  Access key id
      -k, --secret-key <secretKey>  Secret access key
      -b, --bucket <bucket>         Name of the bucket
      -q, --query <query>           Search query
      -h, --host <host>             Host of the server
      -p, --port <port>             Port of the server
      -s                            --ssl
      -v, --verbose
      -h, --help                    output usage information

In the following examples, Zenko Server is accessible on endpoint
:code:`http://127.0.0.1:8000` and contains the bucket :code:`zenkobucket`.

.. code::

    # search for objects with metadata "blue"
    node bin/search_bucket -a accessKey1 -k verySecretKey1 -b zenkobucket \
        -q "x-amz-meta-color=blue" -h 127.0.0.1 -p 8000

    # search for objects tagged with "type=color"
    node bin/search_bucket -a accessKey1 -k verySecretKey1 -b zenkobucket \
        -q "tags.type=color" -h 127.0.0.1 -p 8000

Coding Examples
+++++++++++++++

Search requests can be also performed by making HTTP requests authenticated
with one of the AWS Signature schemes: version 2 or version 4. \
For more about authentication scheme, see:

* https://docs.aws.amazon.com/general/latest/gr/signature-version-2.html
* http://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
* http://docs.aws.amazon.com/general/latest/gr/sigv4-signed-request-examples.html

You can also view examples for making requests with Auth V4 in various
languages `here <../../../examples>`__.

Specifying Metadata Fields
~~~~~~~~~~~~~~~~~~~~~~~~~~

To search system metadata headers:

.. code::

    {system-metadata-key}{supported SQL op}{search value}
    # example
    key = blueObject
    size > 0
    key LIKE "blue.*"

To search custom user metadata:

.. code::

    # metadata must be prefixed with "x-amz-meta-"
    x-amz-meta-{user-metadata-key}{supported SQL op}{search value}

    # example
    x-amz-meta-color = blue
    x-amz-meta-color != red
    x-amz-meta-color LIKE "b.*"

To search tags:

.. code::

    # tag searches must be prefixed with "tags."
    tags.{tag-key}{supported SQL op}{search value}
    # example
    tags.type = color

Examples queries:

.. code::

    # searching for objects with custom metadata "color"=blue" and are tagged
    # "type"="color"

    tags.type="color" AND  x-amz-meta-color="blue"

    # searching for objects with the object key containing the substring "blue"
    # or (custom metadata "color"=blue" and are tagged "type"="color")

    key LIKE '.*blue.*' OR (x-amz-meta-color="blue" AND tags.type="color")

Differences from SQL
++++++++++++++++++++

Zenko metadata search queries are similar to SQL-query :code:`WHERE` clauses, but
differ in that:

* They follow the :code:`PCRE` format
* They do not require values with hyphens to be enclosed in
  backticks, :code:``(`)``

  .. code::

        # SQL query
        `x-amz-meta-search-item` = `ice-cream-cone`

        # MD Search query
        x-amz-meta-search-item = ice-cream-cone

* Search queries do not support all SQL operators.

  .. code::

    # Supported SQL operators:
    =, <, >, <=, >=, !=, AND, OR, LIKE, <>

    # Unsupported SQL operators:
    NOT, BETWEEN, IN, IS, +, -, %, ^, /, *, !

Using Regular Expressions in Metadata Search
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Regular expressions in Zenko metadata search differ from SQL in the following
ways:

+ Wildcards are represented with :code:`.*` instead of :code:`%`.
+ Regex patterns must be wrapped in quotes. Failure to do this can lead to
  misinterpretation of patterns.
+ As with :code:`PCRE`, regular expressions can be entered in either the
  :code:`/pattern/` syntax or as the pattern itself if regex options are
  not required.

Example regular expressions:

.. code::

    # search for strings containing word substring "helloworld"
        ".*helloworld.*"
        "/.*helloworld.*/"
        "/.*helloworld.*/i"
