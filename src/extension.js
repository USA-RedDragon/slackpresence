const vscode = require('vscode');
const basename = require('path').basename;
const https = require('https');
const http = require('http');
const url = require('url');
const querystring = require('querystring')
const languages = require('./languages.js');

var config = vscode.workspace.getConfiguration('slackpresence');

const statusBarIcon = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
statusBarIcon.text = '$(pulse) Connecting to Slack...';

var slackTimer;
var lastFile;

const server = http.createServer(function (req, res) {
	const closeTab = "<h2>Logged In</h2><h4>You may close this window</h4>"
	res.end(closeTab);
	server.close();
	var query = url.parse(req.url, true).query;
	sendRequest('/api/oauth.access', {
		client_id: '5167321442.546836577892',
		client_secret: 'bb787469ad4ce3ad53415a0e05bc288d',
		code: query.code,
		redirect_uri: 'http://localhost:8989'
	}, false, (res) => {
		var body = '';

		res.on('data', (chunk) => {
			body += chunk;
		});
		res.on('end', () => {
			var response = JSON.parse(body);
			if (!response.error) {
				config.update('authToken', response.access_token, true).then(() => {
					// For some reason the config doesn't reload on its own
					config = vscode.workspace.getConfiguration('slackpresence');
					startSharing();
				});
			} else {
				console.log(response.error);
			}
		});
	});
});

function createOauthListener() {
	server.listen(8989);
	console.log("OAUTH server is listening");
}

function sendRequest(path, data, dataIsJson = true, callback = null) {
	const postData = dataIsJson ? JSON.stringify(data) : querystring.stringify(data);
	const options = {
		hostname: 'slack.com',
		port: 443,
		path: path,
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${config.get('authToken')}`,
			'Content-Type': dataIsJson ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded',
			'Content-Length': postData.length
		}
	};
	var req = https.request(options, callback);
	req.on('error', (e) => {
		console.error(e);
	});

	req.write(postData);
	req.end();
	return req;
}

function sendActivity() {
	if (vscode.window.activeTextEditor) {
		const fileName = basename(vscode.window.activeTextEditor.document.fileName);
		if (fileName != lastFile) {
			lastFile = fileName;
			const languageId = vscode.window.activeTextEditor.document.languageId;
			var language = '';
			if(languageId !== undefined) {
				language += languages[languageId] + ': ';
			}
			var workspace = '';
			if(config.get('shareWorkspace')) {
				workspace += ` in workspace ${vscode.workspace.name}`;
			}
			const status = `Working on ${language}${fileName}${workspace}`;
			console.log(status);
			const postData = {
				profile: {
					status_text: status,
					status_emoji: ":vscode:",
					status_expiration: 0
				}
			};
			sendRequest('/api/users.profile.set', postData, true, (res) => {
				var body = '';
		
				res.on('data', (chunk) => {
					body += chunk;
				});
				res.on('end', () => {
					var response = JSON.parse(body);
					if (response.error) {
						console.log(response.error);
					}
				});
			});
		}
	}
}

function startSharing() {
	statusBarIcon.text = '$(pulse) Sharing with Slack...';
	sendActivity();
	slackTimer = setInterval(() => {
		sendActivity();
	}, 200);
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('slackpresence is active');

	if (config.get('enabled')) {
		statusBarIcon.show();
		if (!config.get('authToken')) {
			vscode.window.showErrorMessage('You must install the Slack Integration into your workspace\n[Add to Slack](https://slack.com/oauth/authorize?client_id=5167321442.546836577892&scope=users.profile:write)');
			createOauthListener();
			statusBarIcon.text = '$(pulse) Error connecting to Slack...';
		} else {
			startSharing();
		}
	}

	const enabler = vscode.commands.registerCommand('slackpresence.enable', () => {
		config.update('enabled', true);
		statusBarIcon.show();
		vscode.window.showInformationMessage('Enabled Slack Presence for this workspace.');
	});

	const disabler = vscode.commands.registerCommand('slackpresence.disable', () => {
		config.update('enabled', false);
		statusBarIcon.hide();
		vscode.window.showInformationMessage('Disabled Slack Presence for this workspace.');
	});

	context.subscriptions.push(enabler, disabler)
}

function deactivate() {
	clearImmediate(slackTimer);
	const postData = {
		profile: {
			status_text: '',
			status_emoji: ''
		}
	};
	return sendRequest('/api/users.profile.set', postData);
}

module.exports = {
	activate,
	deactivate
}
