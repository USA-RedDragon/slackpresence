'use strict';
//
// PLEASE DO NOT MODIFY / DELETE UNLESS YOU KNOW WHAT YOU ARE DOING
//
// This file is providing the test runner to use when running extension tests.
// By default the test runner in use is Mocha based.
//
// You can provide your own test runner if you want to override it by exporting
// a function run(testRoot: string, clb: (error:Error) => void) that the extension
// host can call to run the tests. The test runner is expected to use console.log
// to report the results back to the caller. When the tests are finished, return
// a possible error to the callback or null if none.

const fs = require('fs');
const glob = require('glob');
const paths = require('path');

const istanbul = require('istanbul');
const Mocha = require('mocha');
const remapIstanbul = require('remap-istanbul');

// Linux: prevent a weird NPE when mocha on Linux requires the window size from the TTY
// Since we are not running in a tty environment, we just implementt he method statically
var tty = require('tty');
if (!tty.getWindowSize) {
	tty.getWindowSize = function () {
		return [80, 75];
	};
}

var mocha = new Mocha({
	ui: 'tdd',
	useColors: true,
});

function configure(mochaOpts) {
	mocha = new Mocha(mochaOpts);
}

module.exports.configure = configure;

function _mkDirIfExists(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir);
	}
}

function _readCoverOptions(testsRoot) {
	var coverConfigPath = paths.join(testsRoot, '..', 'coverconfig.json');
	if (fs.existsSync(coverConfigPath)) {
		var configContent = fs.readFileSync(coverConfigPath, 'utf-8');
		return JSON.parse(configContent);
	}
	return undefined;
}

function run(testsRoot, clb) {
	// Read configuration for the coverage file
	var coverOptions = _readCoverOptions(testsRoot);

	if (coverOptions && coverOptions.enabled) {
		// Setup coverage pre-test, including post-test hook to report
		var coverageRunner = new CoverageRunner(coverOptions, testsRoot);

		coverageRunner.setupCoverage();
	}
	// Glob test files
	glob('**/**.test.js', { cwd: testsRoot }, function (error, files) {
		if (error) {
			return clb(error);
		}
		try {
			// Fill into Mocha
			files.forEach(function (f) { return mocha.addFile(paths.join(testsRoot, f)); });
			// Run the tests
			var failureCount_1 = 0;
			mocha.run()
				.on('fail', function () { return failureCount_1++; })
				.on('end', function () { coverageRunner.reportCoverage(); return clb(undefined, failureCount_1); });
		}
		catch (error) {
			return clb(error);
		}
	});
}

module.exports.run = run;

class CoverageRunner {
	
	constructor(options, testsRoot) {
		this.options = options;
		this.testsRoot = testsRoot;
		this.coverageVar = '$$cov_' + new Date().getTime() + '$$';
		this.transformer = undefined;
		this.matchFn = undefined;
		this.instrumenter = undefined;
		if (!options.relativeSourcePath) {
			return;
		}
	}

	setupCoverage () {
		// Set up Code Coverage, hooking require so that instrumented code is returned
		var self = this;
		self.instrumenter = new istanbul.Instrumenter({ coverageVariable: self.coverageVar });
		var sourceRoot = paths.join(self.testsRoot, self.options.relativeSourcePath);
		// Glob source files
		var srcFiles = glob.sync('**.js', {
			cwd: sourceRoot,
			ignore: self.options.ignorePatterns,
		});
		// Create a match function - taken from the run-with-cover.js in istanbul.
		var decache = require('decache');
		var fileMap = {};
		srcFiles.forEach(function (file) {
			var fullPath = paths.join(sourceRoot, file);
			fileMap[fullPath] = true;
			// On Windows, extension is loaded pre-test hooks and this mean we lose
			// our chance to hook the Require call. In order to instrument the code
			// we have to decache the JS file so on next load it gets instrumented.
			// This doesn't impact tests, but is a concern if we had some integration
			// tests that relied on VSCode accessing our module since there could be
			// some shared global state that we lose.
			decache(fullPath);
		});
		self.matchFn = (file) => { return fileMap[file]; };
		self.matchFn.files = Object.keys(fileMap);
		// Hook up to the Require function so that when this is called, if any of our source files
		// are required, the instrumented version is pulled in instead. These instrumented versions
		// write to a global coverage variable with hit counts whenever they are accessed
		self.transformer = self.instrumenter.instrumentSync.bind(self.instrumenter);
		var hookOpts = { verbose: self.options.verbose, extensions: ['.js'] };
		istanbul.hook.hookRequire(self.matchFn, self.transformer, hookOpts);
		// initialize the global variable to stop mocha from complaining about leaks
		//global[self.coverageVar] = {};
		// Hook the process exit event to handle reporting
		// Only report coverage if the process is exiting successfully

		process.on('exit', function (code) {
			self.reportCoverage();
			process.exitCode = code;
		});
	};
	
	/**
	 * Writes a coverage report.
	 * Note that as this is called in the process exit callback, all calls must be synchronous.
	 *
	 * @returns {void}
	 *
	 * @memberOf CoverageRunner
	 */
	reportCoverage() {

		var self = this;
		istanbul.hook.unhookRequire();
		var cov;
		if (typeof global[self.coverageVar] === 'undefined' || Object.keys(global[self.coverageVar]).length === 0) {
			console.error('No coverage information was collected, exit without writing coverage information');
			return;
		}
		else {
			cov = global[self.coverageVar];
		}
		// TODO consider putting this under a conditional flag
		// Files that are not touched by code ran by the test runner is manually instrumented, to
		// illustrate the missing coverage.
		self.matchFn.files.forEach(function (file) {
			if (cov[file]) {
				return;
			}
			self.transformer(fs.readFileSync(file, 'utf-8'), file);
			// When instrumenting the code, istanbul will give each FunctionDeclaration a value of 1 in coverState.s,
			// presumably to compensate for function hoisting. We need to reset this, as the function was not hoisted,
			// as it was never loaded.
			Object.keys(self.instrumenter.coverState.s).forEach(function (key) {
				self.instrumenter.coverState.s[key] = 0;
			});
			cov[file] = self.instrumenter.coverState;
		});
		// TODO Allow config of reporting directory with
		var reportingDir = paths.join(self.testsRoot, self.options.relativeCoverageDir);
		var includePid = self.options.includePid;
		var pidExt = includePid ? ('-' + process.pid) : '';
		var coverageFile = paths.resolve(reportingDir, 'coverage' + pidExt + '.json');
		// yes, do this again since some test runners could clean the dir initially created
		_mkDirIfExists(reportingDir);
		fs.writeFileSync(coverageFile, JSON.stringify(cov), 'utf8');
		var remappedCollector = remapIstanbul.remap(cov, {
			warn: function (warning) {
				// We expect some warnings as any JS file without a typescript mapping will cause this.
				// By default, we'll skip printing these to the console as it clutters it up
				if (self.options.verbose) {
					console.warn(warning);
				}
			}
		});
		var reporter = new istanbul.Reporter(undefined, reportingDir);
		var reportTypes = (self.options.reports instanceof Array) ? self.options.reports : ['lcov'];
		reporter.addAll(reportTypes);
		reporter.write(remappedCollector, true, function () {
			console.log("reports written to " + reportingDir);
		});
	};
};
