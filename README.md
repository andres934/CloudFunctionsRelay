# Cloud Functions Assistant

NodeJS project to handle Google Assistant texts commands over Firebase Cloud Functions
plus some Google tools

## Requirements
* Firebase project
* Firebase admin service key(From GoogleCloudConsole)
* Web OAuth2 key(FromCloudConsole)

## Before you begin
* Download the Web OAuth2 key, rename it as secrets.json and save it in functions/config/secrets
* Download the Firebase admin service key, rename it as admin_fb_key.json and save it in functions
* Run ```npm install``` on root and functions/ directory

## IMPORTANT
For Google Assistant to work you need the Refresh Token from google, this token you can only request the FIRST time you are giving access permission to a certain app, after that, if you try to request the Refresh Token you will get a invalid_grant error, so if you are testing with a application with the permissions already given, you have to go to [Google Account Privacy](https://myaccount.google.com/security) and delete permission access over "Third party apps" so the app can request the access again

## Request and Response

```javascript
//Request Object Structure
{
    "idFB": String,         //idFB of the request user
    "userAuthCode": String, //User Google Auth Code
    "speakedText": String   //Text command your want to send to Google Assistant
}
```

```javascript
//Response Object Structure
{
    "response": String,      //Text response from google assistant/token requested
    "audio": String,         //Audio Buffer response from google assistant
    "error": Array<String>,  //The catched errors during the execution
    "success": Boolean       //If response is success
}
```

## Library

Google Assistant is handled by the library:
https://github.com/Dabolus/nodejs-assistant