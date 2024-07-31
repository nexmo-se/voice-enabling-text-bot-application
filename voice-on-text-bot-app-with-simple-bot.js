'use strict'

//-------------

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser')
const app = express();
const axios = require('axios');

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

const servicePhoneNumber = process.env.SERVICE_PHONE_NUMBER;

//-- For testing with outbound calls from the platform --
const calleeNumber = process.env.CALLEE_NUMBER;

//--- Vonage API ---

const { Auth } = require('@vonage/auth');

const credentials = new Auth({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  applicationId: process.env.APP_ID,
  privateKey: './.private.key'    // private key file name with a leading dot 
});

const apiBaseUrl = "https://" + process.env.API_REGION;

const options = {
  apiHost: apiBaseUrl
};

const { Vonage } = require('@vonage/server-sdk');

const vonage = new Vonage(credentials, options);

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

//--- just testing making outbound an call from a local request ---
//-- https://<this-server>/makecall --

app.get('/makecall', async (req, res) => {

  res.status(200).send('Ok');

  const response = await axios.post('https://' + req.hostname + '/placecall', 
    {
      'type': 'phone',
      'number': calleeNumber  // replace with the actual phone number to call for tests
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    }
  );

  // console.log('Place call request:', response.status);

});

//-----------------

app.post('/placecall', (req, res) => {

  res.status(200).send('Ok');

  const hostName = req.hostname;

  vonage.voice.createOutboundCall({
    to: [{
      type: 'phone',
      number: req.body.number
    }],
    from: {
     type: 'phone',
     number: servicePhoneNumber
    },
    answer_url: ['https://' + hostName + '/answer'],
    answer_method: 'GET',
    event_url: ['https://' + hostName + '/event'],
    event_method: 'POST'
    })
    .then(res => {
      console.log(">>> Outgoing PSTN call status:", res);
    })
    .catch(err => console.error(">>> Outgoing PSTN call error:", err))

});

//-------

app.get('/answer', (req, res) => {

    console.log('>>> in answer webhook!');

    const uuid = req.query.uuid;
    const hostName = `${req.hostname}`;
    
    let nccoResponse = [
        {
          "action": "talk",
          "language": languageCode,
          "text": greetingText,
          "style": ttsStyle
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

  // console.log('>>> /event', req.body);

  res.status(200).send('Ok');

});

//---------

app.post('/asr', async (req, res) => {

  const hostName = req.hostname;
  const uuid = req.body.uuid;

  //--

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

      //--

      if (transcript != "" && transcript != null) {

        const response = await axios.post(botUrl, 
          {
            'id': uuid,  // to match corresponding call, metadata must be returned in reply from text bot
            'textRequest': transcript,  // user's request
            'language': language,
            'webhookUrl': 'https://' + hostName + '/botreply'
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          }
        );

        console.log('Bot request return code:', response.status);

      };  

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

app.post('/rtc', (req, res) => {

  res.status(200).send('Ok');

  if (req.body.type == 'audio:speaking:on') {  // barge in here
    
    vonage.voice.stopTTS(req.body.body.channel.id)
      .then(res => console.log('Play TTS status:', res))
      .catch(err => null);
  
  }

});

//------------

app.post('/botreply', (req, res) => {

  res.status(200).send('Ok');

  const hostName = `${req.hostname}`;

  const callUuid = req.body.id;

  // console.log('>>> Bot reply:', req.body);

  const botTextReponse = req.body.botTextReponse;

  console.log('>>> bot response:', botTextReponse);

  vonage.voice.playTTS(callUuid,  
    {
    text: botTextReponse,
    language: languageCode, 
    style: ttsStyle,
    bargeIn: true
    })
    .then(res => console.log('Play TTS status:', res))
    .catch(err => null);

});


//=========================================

const port = process.env.PORT || 8000;

app.listen(port, () => console.log(`Voice API application listening on port ${port}!`));

//------------
