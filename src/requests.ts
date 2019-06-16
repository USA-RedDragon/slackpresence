import * as querystring from 'querystring';
import config from './config';
import * as https from 'https';
import * as http from 'http';

export function sendRequest(
	path: string,
	data: object|string,
	json = true,
	authToken: string = '',
	callback = (res: http.IncomingMessage) => {}) {
	const postData = json ? JSON.stringify(data) : querystring.stringify(data);
	const options: https.RequestOptions = {
		hostname: 'slack.com',
		port: 443,
		path: path,
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${authToken}`,
			'Content-Type': json ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded',
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
