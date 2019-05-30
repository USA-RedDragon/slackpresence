import * as vscode from 'vscode';
import { basename } from 'path';
import * as http from 'http';

import languages from './languages';
import config from './config';
import { sendRequest } from './requests';
import { createOauthListener } from './oauthServer';

const statusBarIcon = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
statusBarIcon.text = '$(pulse) Connecting to Slack...';

var slackTimer: NodeJS.Timeout;
var lastFile: string;

function sendActivity() {
	if (vscode.window.activeTextEditor) {
		const fileName = basename(vscode.window.activeTextEditor.document.fileName);
		if (fileName !== lastFile) {
			lastFile = fileName;
			const languageId = vscode.window.activeTextEditor.document.languageId;
			var language = '';
			if(languageId !== undefined) {
				language += `${languages[languageId]}: `;
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
					status_emoji: config.get('icon'),
					status_expiration: 0
				}
			};
			sendRequest('/api/users.profile.set', postData, true, (res: http.IncomingMessage) => {
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

export function startSharing() {
	statusBarIcon.text = '$(pulse) Sharing with Slack...';
	sendActivity();
	slackTimer = setInterval(() => {
		sendActivity();
	}, 200);
}

export function activate(context: vscode.ExtensionContext) {
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

	context.subscriptions.push(enabler, disabler);
}

export  function deactivate() {
	clearTimeout(slackTimer);
	const postData = {
		profile: {
			status_text: '',
			status_emoji: ''
		}
	};
	return sendRequest('/api/users.profile.set', postData);
}
