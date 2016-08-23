# predix-cdn

The purpose of this module is to take a Predix UI component, vulcanize it, and upload it to GE Digital's CDN.

It provides some small optimizations, in that it attempts to refer to the CDN versions of Font-Awesome and GE Inspira.

## Dependencies

This package depends on the following environment variables being set:

```
process.env.AWS_ACCESS_KEY
process.env.AWS_SECRET_ACCESS_KEY
process.env.HTTP_PROXY
```

## Usage

This package is meant to be passed an options object with the following properties:

* org (string) nNormally "predixdev". This is used in the path on the CDN
* name (string) The name of the component
* version (string) The version of the component to use in the path on the CDN
* dryrun (bool) Don't upload the file to the CDN (useful for testing)
* files [array] paths to this components files. This is necessary because in order to vulcanize a px- component cloned from a git repository, paths to dependencies need to be changed to point to bower_components/

### Example

```
use strict';
// This node application vulcanizes and copies the files specified in the 'files' array to our CDN
//
// Usage:
//   node cdnify.js (-v <version>) (-d)
//
// Options:
//   -v (string) Version (optional, bower.json used if not provided).
//   -d (null)   Dry run (optional). Does everything but upload to the CDN.
//
// Dependencies:
//   process.env.AWS_ACCESS_KEY
//   process.env.AWS_SECRET_ACCESS_KEY
//   process.env.HTTP_PROXY

var args = require('minimist')(process.argv.slice(2), {'--':true,alias:{v:'version',d:'dryrun'}}),
    fs = require('fs-extra'),
    cdn = require('px-cdn');

// #######################################################
// CONFIGURATION

var options = {
  org: 'predixdev',
  name: fs.readJsonSync('./bower.json').name,
  version: args.v || fs.readJsonSync('./bower.json').version,
  dryrun: args.d,
  // Files that compose this component.
  // We need to specify these so we can rewrite all the relative
  // dependency paths to properly point to bower_components
  // before we vulcanize the whole thing into one file.
  files: [
    'css/px-dropdown-chevron.css',
    'css/px-dropdown-content.css',
    'css/px-dropdown-text.css',
    'css/px-dropdown.css',
    'px-dropdown.html',
    'px-dropdown-chevron.html',
    'px-dropdown-content.html',
    'px-dropdown-text.html'
  ]
};

// END CONFIGURATION
// #######################################################

// CDNify and upload the files in options.files
cdn.cdnify(options);
```
