// Google and Firebase imports Se importan las funciones de Firebase y Google
const {https} = require('firebase-functions');
const {google} = require('googleapis');
const admin = require('firebase-admin');

const ewelink = require('ewelink-api');

// Google Assistant imports
const Assistant = require('nodejs-assistant').Assistant;
const AssistantLanguage = require('nodejs-assistant').AssistantLanguage;

/* Init the credentials of the OAuth2 and the project
*  The used document have to be exact the same of the project where you sign in with Google
*  The document can be created/downloaded from Google Cloud Console
*/
const _client_id = require('./config/secrets/secrets.json').web.client_id; 
const _client_secret = require('./config/secrets/secrets.json').web.client_secret;
const redirect = require('./config/secrets/secrets.json').web.redirect_uris[0];  
const project = require('./config/secrets/secrets.json').web.project_id;

const OAuth2 = google.auth.OAuth2;
var error = null;
var map = {
    "response": "",
    "audio": "",
    "error": [],
    "success": false
};

function cleanMap() {
    map["response"] = "";
    map["audio"] = "";
    map["error"] = [];
    map["success"] = false;
}

function addValueToResponse(key, value) {
    //If the key is error will push to a list, otherwise will set the value
    if (key === "error") {
        map[key].push(value);
    } else {
        map[key] = value;
    }
}

// Init Firebase and Firestore as admin
function initializeApp() {

	const serviceAccount = require('./admin_fb_key.json');

    if (admin.apps.length === 0) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: `https://${project}.firebaseio.com`
        });
    }

	return admin.firestore();

}

// We build the Google OAuth2 instance with the giving credentials
function getOAuthClient() {
    return new OAuth2(
        _client_id,
        _client_secret,
        redirect
        );
}

// Method to set the catched errors during the execution
function setError(msg) {
    map["error"].push(msg);
    if (error === null) {
        error = msg;
    }
    console.error(msg);
}

/*  - We save the token data from google using the existing idFBUser
*   - Return true if success
*/
async function saveRefreshFirebase(idFB, token) {
    const dbFB = initializeApp();

    await dbFB.collection('tokens')
    .add({
        idFBUser: idFB,
        refreshToken: token
    })
    .then( ref => {
        console.log('Added token with id: ', ref.id);
        return true;
    })
    .catch( err => {
        console.log('Cant storage the token: ', err);
        return false;
    });
}

/*We search the Refresh Token stored in Firebase using the idFB of the user*/
async function getRefreshTokenFirebaseAsync(idFB) {
    const dbFB = initializeApp();
    var result = "";

    const response = await dbFB.collection('tokens').where('idFBUser', '==', idFB).get();
    if (response) {
        var snap = response.docs;
        if (snap.length > 0) {
            snap.forEach( (doc) => {
                console.log(`Refresh token found => ${doc.data()}`);
                result = doc.data().refreshToken.refresh_token 
            });
        } else {
            console.log(`The user ${idFB} doesn't have token`);
            result = null;
        }
    }

    return result;

}

/* - We request the refresh token to Google with the Authorization Code
*    from the previous Google sign in
*  - The token request returns an object and that full object is stored in Firebase
*    with the name refreshToken.
*/
async function getRefreshToken(authCode, idFBUser) {
    return new Promise( (resolve, reject) => {
        getOAuthClient().getToken(authCode, async (err, token) => {
            if (!err) {
                console.log(`Get Token success, token: ${token}`);
                await saveRefreshFirebase(idFBUser, token)
                // We resolve with token.refresh_token because Google returns an object
                resolve(token.refresh_token);
            } else {
                if (err.response.data.error === "invalid_grant") {
                    console.log("Get Token error: Refresh Token is already granted");
                } else {
                    setError(`Get Token error: ${err.response.data.error}, code: ${err.code}`);
                }
                reject(err);
            }
        });
    });
}

/*- Similar method of getRefreshToken, this one only returns the full token object and doesn't store in Firebase*/
async function getFullRefreshToken(authCode) {
    return new Promise( (resolve, reject) => {
        getOAuthClient().getToken(authCode, async (err, token) => {
            if (!err) {
                console.log(`Get Token success, token: ${token}`);
                resolve(token.refresh_token);
            } else {
                if (err.response.data.error === "invalid_grant") {
                    console.log("Get Token error: Refresh Token is already granted");
                } else {
                    setError(`Get Token error: ${err.response.data.error}, code: ${err.code}`);
                }
                reject(err);
            }
        });
    });
}

/*Async method to refresh Accesstoken with the RefreshToken*/
async function refreshAccessToken(refreshToken) {
    return new Promise( (resolve, reject) => {
        
        console.log(`Refreshing Token with refresh: ${refreshToken}`);

        const client = getOAuthClient();

        client.setCredentials({
            refresh_token: refreshToken
        });

        client.getAccessToken()
        .then( token => {
            console.log(`New Access Token is: ${token.token}`);
            resolve(token.token);
            return;
        })
        .catch( err => {
            reject(err);
        });
        
    });
}

/* - Searching Refresh Token
*  - The search will begin on Firebase to optimize the request, the Refresh Token doesn't expire
*    so if exist, we re-use it
*  - If doesn't exist we request a new one to Google
* NOTE: The request of the Refresh Token will only work the first time you request it
* after signing in with your google account and grant access, if you request it after that it will return
* request error invalid_grant
*/
async function requestRefreshToken(authCode, idFBUser) {
    const token = await getRefreshTokenFirebaseAsync(idFBUser);
    if (token !== null) {
        console.log("TOKEN DATA:", token);
        return token;
    } else {
        console.log("Refresh token of Firebase is null, Requesting new one");
        if (authCode !== null) {
            var myToken = await getRefreshToken(authCode, idFBUser);
            return myToken;
        } else {
            setError("Authorization Code is null, can't request Refresh Token");
            return null;
        }
    }
}

/*Request Refresh Token and then build the Google Assistant instance*/
async function getAssistantAsync(idFB, authCode) {
    const token = await requestRefreshToken(authCode, idFB);

    if (token !== null) {
        console.log("TOKEN DATA SUCCESS:", token);
        return buildAssistant(token);
    } else {
        return null
    }

}

/*Build Google Assistant instance*/
function buildAssistant(refreshToken) {
    const assistant = new Assistant({
        type: 'authorized_user',
        client_id: _client_id,
        client_secret: _client_secret,
        refresh_token: refreshToken, 
    }, /* Optional config */ {
        locale: AssistantLanguage.SPANISH_ES,
        deviceId: 'your device id', // As we are not using a physical certified device we set this blank or default
        deviceModelId: 'your device model id', // As we are not using a physical certified device we set this blank or default
    });
    console.log("Assistente is not null");
    return assistant;
}

/*Firebase Functions HTTP Request to refresh the Access Token*/
exports.refreshMyAccessToken = https.onRequest( async (req, res) => {
    console.log("----------------------------------- RefreshMyAccessToken New Request -----------------------------------");
    const refreshToken = req.body.refreshToken;
    refreshAccessToken(refreshToken)
    .then( token => {
        addValueToResponse("success", true);
        addValueToResponse("response", token);
        res.status(200).send(map);
        cleanMap();
        return;
    })
    .catch( err => {
        setError(err);
        res.status(400).send(map);
        cleanMap();
    })
});

/*Firebase Functions HTTP Request to get RefreshToken with AuthCode*/
exports.requestMyRefresToken = https.onRequest( async (req, res) => {
    console.log("----------------------------------- RequestMyRefreshToken New Request -----------------------------------");
    const authCode = req.body.userAuthCode;
    getFullRefreshToken(authCode)
    .then( tokenData => {
        addValueToResponse("success", true);
        addValueToResponse("response", tokenData);
        res.status(200).send(map);
        cleanMap();
        return;
    })
    .catch( err => {
        setError(err);
        addValueToResponse("success", false);
        addValueToResponse("response", "Error getting Refresh Token");
        res.status(400).send(map);
        cleanMap();
    });
});

/*Firebase Functions HTTP Request to send a text command to Google Assistant*/ 
exports.queryAssistant = https.onRequest( async (req, res) => {
    const idFB = req.body.idFB
    // Authcode is need it just the first time, then can be empty
    const authCode = req.body.userAuthCode;
    const text = req.body.speakedText;
    if (idFB === "" || idFB === null) {
        setError("idFB is null or empty, check params");
        addValueToResponse("success", false);
        addValueToResponse("response", "Error sending command");
        res.status(400).send(map);
        cleanMap();
        return;
    }
    if (text === "" || text === null) {
        setError("The command can't be null or empty");
        addValueToResponse("success", false);
        addValueToResponse("response", "Error sending command");
        res.status(400).send(map);
        cleanMap();
        return;
    }
    const assistant = await getAssistantAsync(idFB, authCode);
    if (assistant !== null) {
        assistant.query(text)
        .then(response => {
            console.log(`Response: ${JSON.stringify(response)}`);
            addValueToResponse("success", true);
            addValueToResponse("response", response.text || "");
            res.status(200).send(map);
            return;
        })
        .catch(err => {
            setError(`${err}`);
            addValueToResponse("success", false);
            addValueToResponse("response", "Error sending command");
            res.status(400).send(map);
        });
    } else {
        setError('Assistant is null, check params')
        addValueToResponse("success", false);
        addValueToResponse("response", "Error sending command");
        res.status(400).send(map);
    }
    cleanMap();
});