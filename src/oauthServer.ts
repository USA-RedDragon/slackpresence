import * as url from 'url';
import * as http from 'http';
import { sendRequest } from './requests';
import config from './config';
import  { startSharing } from './extension';

const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
	const closeTab = "<h2>Logged In</h2><h4>You may close this window</h4>";
	res.end(closeTab);
    server.close();
    if(req.url) {
        var query = url.parse(req.url, true).query;
        console.log(`Code "${query.code}"`);
        sendRequest('/api/oauth.access', {
            client_id: '5167321442.546836577892',
            client_secret: 'bb787469ad4ce3ad53415a0e05bc288d',
            code: query.code,
            redirect_uri: 'http://localhost:8989'
        }, false, (res: http.IncomingMessage) => {
            var body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                var response = JSON.parse(body);
                console.log(response);
                if (!response.error) {
                    config.update('authToken', response.access_token, true).then(() => {
                        startSharing();
                    });
                } else {
                    console.log(response.error);
                }
            });
        });
    }
});

export function createOauthListener() {
	server.listen(8989);
	console.log("OAUTH server is listening");
}