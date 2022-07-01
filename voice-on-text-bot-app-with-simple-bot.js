'use strict'

//-------------

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser')
const app = express();
const expressWs = require('express-ws')(app);
const Vonage = require('@vonage/server-sdk');
const { Readable } = require('stream');

// ------------------

// HTTP client
const webHookRequest = require('request');

const reqHeaders = {
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

 //---- CORS policy - Update this section as needed ----

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "OPTIONS,GET,POST,PUT,DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");
  next();
});

//-------

app.use(bodyParser.json());

//-------

let router = express.Router();
router.get('/', express.static('app'));
app.use('/app',router);

//------

const servicePhoneNumber = process.env.SERVICE_PHONE_NUMBER;

//-------------

const vonage = new Vonage({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  applicationId: process.env.APP_ID,
  privateKey: './.private.key'
});

//-------------

// Server hosting the very simple Bot to simulate interaction with a real Text Bot
const botServer = process.env.BOT_SERVER;
// this application will make HTTP POST requests to the URL https://<botServer>/bot
const botUrl = "https://" + botServer + "/bot";

//-------------

// Voice API ASR parameters
// See https://developer.nexmo.com/voice/voice-api/ncco-reference#speech-recognition-settings

const endOnSilence = 1.0; // adjust as needed for your user's voice interaction experience
const startTimeout = 10;  // adjust as needed for your user's voice interaction experience

//-------------

// Language locale settings

// Vonage Voice API supports multiple language locales for ASR (Automatic Speech Recognition) and TTS (Text To Speech) as listed in
// https://developer.vonage.com/voice/voice-api/guides/asr#language
// and
// https://developer.vonage.com/voice/voice-api/guides/text-to-speech#supported-languages

// We use both ASR and TTS capabilities of Vonage Voice API for this application

// In this example, uncomment the set of paramaters below for the language you would like to try, and comment the other set of parameters

// For French samples
// const languageCode = process.env.LANGUAGE_CODE || 'fr-FR';
// const language = process.env.LANGUAGE || 'fr';
// const ttsStyle = process.env.TTS_STYLE || 6; // see https://developer.nexmo.com/voice/voice-api/guides/text-to-speech
// const greetingText = process.env.GREETING_TEXT || "Bonjour";

// For English samples
const languageCode = process.env.LANGUAGE_CODE || 'en-US';
const language = process.env.LANGUAGE || 'en';
const ttsStyle = process.env.TTS_STYLE || 11; // see https://developer.nexmo.com/voice/voice-api/guides/text-to-speech
const greetingText = process.env.GREETING_TEXT || "Hello";

//-----------

console.log("Service phone number:", servicePhoneNumber);

//==========================================================

function reqCallback(error, response, body) {
    if (body != "Ok") {  
      console.log("HTTP request call status:", body);
    };  
}
 
//--- just testing making calls from a local request
app.get('/makecall', (req, res) => {

  res.status(200).send('Ok');

  const hostName = `${req.hostname}`;

  let callInfo;
  let reqOptions;

  callInfo = {
    'type': 'phone',
    'number': '12995550101'  // replace with the actual phone number to call for tests
  };

  console.log("callInfo:", JSON.stringify(callInfo));

  reqOptions = {
    url: 'https://' + hostName + '/placecall',
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(callInfo)
  };

  console.log("webHookRequest 1");

  webHookRequest(reqOptions, reqCallback);

});

//-----------------

app.post('/placecall', (req, res) => {

  res.status(200).send('Ok');

  const hostName = `${req.hostname}`;
  const numberToCall = req.body.number;

  vonage.calls.create({
    to: [{
      type: 'phone',
      number: numberToCall
    }],
    from: {
     type: 'phone',
     number: servicePhoneNumber
    },
    answer_url: ['https://' + hostName + '/answer'],
    answer_method: 'GET',
    event_url: ['https://' + hostName + '/event'],
    event_method: 'POST'
    }, (err, res) => {
    if(err) {
      console.error(">>> outgoing call error:", err);
      console.error(err.body);
    } else {
      console.log(">>> outgoing call status:", res);
    }
  });

});

//-------

app.get('/answer', (req, res) => {

    const uuid = req.query.uuid;
    const hostName = `${req.hostname}`;
    
    let nccoResponse = [
        {
          "action": "talk",
          "language": languageCode,
          "text": greetingText,
          "style": ttsStyle,
          "bargeIn": true
        },
        {
          "action": "input",  // see https://developer.nexmo.com/voice/voice-api/ncco-reference#speech-recognition-settings
          "eventUrl": ["https://" + hostName + "/asr"],
          "eventMethod": "POST",
          "type": ["speech"],  
          "speech":
            {
            "uuid": [uuid], 
            "endOnSilence": endOnSilence, 
            "language": languageCode,
            "startTimeout": startTimeout
            } 
        }
    ];  

    res.status(200).json(nccoResponse);

});

//-------

app.post('/event', (req, res) => {

  res.status(200).send('Ok');

});

//---------

app.post('/asr', (req, res) => {

  const hostName = `${req.hostname}`;

  const uuid = req.body.uuid;

  const nccoResponse = [
    {
    "action": "input",  // see https://developer.nexmo.com/voice/voice-api/ncco-reference#speech-recognition-settings
    "eventUrl": ["https://" + hostName + "/asr"],
    "eventMethod": "POST",
    "type": ["speech"],  
    "speech":
      {
      "uuid": [uuid], 
      "endOnSilence": endOnSilence, 
      "language": languageCode,
      "startTimeout": startTimeout
      } 
    }
  ];

  res.json(nccoResponse);

  //----

  if (req.body.speech.hasOwnProperty('results')) {

    if(req.body.speech.results == undefined || req.body.speech.results.length < 1) {

      console.log(">>> No speech detected");

      if (req.body.speech.hasOwnProperty('timeout_reason')) {
        console.log('>>> ASR timeout reason:', req.body.speech.timeout_reason);
      }  

    } else {

      const transcript = req.body.speech.results[0].text;
      console.log(">>> Detected spoken request:", transcript);

      const userRequest = {
        'id': uuid,  // to match corresponding call, metadata must be returned in reply from text bot
        'textRequest': transcript,  // user's request
        'language': language,
        'webhookUrl': 'https://' + hostName + '/botreply'
      };

      const reqOptions = {
        url: botUrl,
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(userRequest)
      };

      // send request to text bot  
      webHookRequest(reqOptions, reqCallback);
    }  

  } else {

    if (req.body.speech.hasOwnProperty('timeout_reason')) {
      console.log('>>> ASR timeout reason:', req.body.speech.timeout_reason);
    }      

    if (req.body.speech.hasOwnProperty('error')) {
      console.log('>>> ASR error:', req.body.speech.error);
    }  

  };

});

//------------

app.post('/botreply', (req, res) => {

  res.status(200).send('Ok');

  const hostName = `${req.hostname}`;

  const callUuid = req.body.id;

  // console.log('>>> Bot reply:', req.body);

  const botTextReponse = req.body.botTextReponse;

  console.log('>>> bot response:', botTextReponse);

  vonage.calls.talk.start(callUuid,  // play TTS of chatbot response
    {
    text: botTextReponse,
    language: languageCode, 
    style: ttsStyle
    }, (err, res) => {
       if (err) { console.error('Talk ', callUuid, 'error: ', err, err.body); }
       else {
         console.log('Talk ', callUuid, 'status: ', res);
    }
  });

});


//=========================================

const port = process.env.PORT || 8000;

app.listen(port, () => console.log(`Voice API application listening on port ${port}!`));

//------------
