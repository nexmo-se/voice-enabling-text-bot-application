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

// In this example, uncomment the set of paramaters below for the language you would like to try, and comment the other set of parameters below


//--- For French samples
// const languageCode = process.env.LANGUAGE_CODE || 'fr-FR';
// const language = process.env.LANGUAGE || 'fr';
// const ttsStyle = process.env.TTS_STYLE || 6; // see https://developer.nexmo.com/voice/voice-api/guides/text-to-speech
// const greetingText = process.env.GREETING_TEXT || "Bonjour";
// const wakeUpBotText = process.env.WAKE_UP_BOT_TEXT || "Bonjour";
// const defaultBotGreetingText = process.env.DEFAULT_BOT_GREETING_TEXT || "Comment puis-je vous aider ?";

//--- For English samples
const languageCode = process.env.LANGUAGE_CODE || 'en-US';
const language = process.env.LANGUAGE || 'en';
const ttsStyle = process.env.TTS_STYLE || 11; // see https://developer.nexmo.com/voice/voice-api/guides/text-to-speech
const greetingText = process.env.GREETING_TEXT || "Hello";
const wakeUpBotText = process.env.WAKE_UP_BOT_TEXT || "Hello";
const defaultBotGreetingText = process.env.DEFAULT_BOT_GREETING_TEXT || "How may I help you?";

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
      console.error(err.body.title);
      console.error(err.body.invalid_parameters);
    } else {
      console.log(">>> outgoing call status:", res);
    }
  });

});

//-------

app.get('/answer', (req, res) => {

    const hostName = `${req.hostname}`;

    const uuid = req.query.uuid;

    app.set('botResponse_' + uuid, defaultBotGreetingText);  // in case text bot is unresponsive
    
    let nccoResponse = [
        {
          "action": "conversation",
          "name": "conference_" + uuid,
          "startOnEnter": true
        }
      ];

    res.status(200).json(nccoResponse);

});


//-------

app.post('/event', (req, res) => {

  res.status(200).json({});

  const hostName = `${req.hostname}`;

  const uuid = req.body.uuid;

  if (req.body.type === 'transfer') {
    if (app.get('firstTransferDone_' + uuid) === 'no') {
      app.set('firstTransferDone_' + uuid, 'yes');  // call has been connected to conversation (first transfer event)

      // INSERT YOUR CODE HERE    
      // get welcome greeting from your text chatbot

      // then in this sample code framework
      // your chatbot will call back the webhook path '/botreply' (below)
      // to supply the text reply and metadata to link with original
      // request, for example return the uuid value
    }
  }

  if (req.body.status === "completed") {

    app.set('botResponse_' + uuid, undefined);
    app.set('firstTransferDone_' + uuid, undefined);

  }

});

//---------

app.post('/asr', (req, res) => {

  res.status(200).send('Ok');

  const uuid = req.body.uuid;
  const hostName = `${req.hostname}`;

  if (req.body.speech.hasOwnProperty('results')) {

    if(req.body.speech.results == undefined || req.body.speech.results.length < 1) {

      console.log(">>> No speech detected");

      if (req.body.speech.hasOwnProperty('timeout_reason')) {
        console.log('>>> ASR timeout reason:', req.body.speech.timeout_reason);
      }  

      // TO DO: need to set a default response in case bot never replies or with too much delay
      const ttsText = app.get('botResponse_' + uuid);

      console.log(">>> New ASR, text:", ttsText, "on call:", uuid);
      doNewAsr(uuid, ttsText, hostName);

    } else {

      const transcript = req.body.speech.results[0].text;
      console.log(">>> Detected spoken request:", transcript);

      // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
      // ENTER YOUR CODE HERE
      // TO SEND TEXT REQUEST TO CHATBOT
      // your chatbot will call back the webhook path '/botreply' (below)
      // to supply the text reply and metadata to link with original
      // request, for example return the uuid value
      // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

    }  


  } else {


  if (req.body.speech.hasOwnProperty('timeout_reason')) {
    console.log('>>> ASR timeout reason:', req.body.speech.timeout_reason);
  }      

  if (req.body.speech.hasOwnProperty('error')) {
    console.log('>>> ASR error:', req.body.speech.error);
  }  

  const ttsText = app.get('botResponse_' + uuid);

  console.log(">>> New ASR, text:", ttsText, "on call:", uuid);
  doNewAsr(uuid, ttsText, hostName);

  };  

});

//------------

app.post('/botreply', (req, res) => {

  res.status(200).send('Ok');

  const hostName = `${req.hostname}`;

  const callUuid = req.body.id;

  // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
  // ENTER YOUR CODE HERE
  // TO RECEIVE TEXT RESPONSE FROM CHATBOT
  // assign chatbotbot response to botTextReponse parameter, i.e.
  // const botTextReponse = <chatbot response>;
  // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

  console.log('>>> my chatbot response:', botTextReponse);

  app.set('botResponse_' + callUuid, botTextReponse);

  doNewAsr(callUuid, botTextReponse, hostName);

});

//----------------------------------------

function doNewAsr(vapiCallUuid, ttsText, host) {

  vonage.calls.update(vapiCallUuid, {
    "action": "transfer",
    "destination":
      {
      "type": "ncco",
      "ncco":
        [
          {
          "action": "talk",
          "language": languageCode,
          "text": ttsText,
          "style": ttsStyle,
          "bargeIn": true
          }
          ,
          {
          "action": "input",  // see https://developer.nexmo.com/voice/voice-api/ncco-reference#speech-recognition-settings
          "eventUrl": ["https://" + host + "/asr"],
          "eventMethod": "POST",
          "type": ["speech"],  
          "speech":
            {
            "uuid": [vapiCallUuid], 
            "endOnSilence": endOnSilence, 
            "language": languageCode,
            "startTimeout": startTimeout
            } 
          }
          ,
          {
          "action": "conversation",
          "name": "conference_" + vapiCallUuid
          }   
        ]
      }
    }, (err, res) => {
       if (err) { console.error('Transfer', vapiCallUuid, 'error: ', err, err.body.invalid_parameters); }
       // else { console.log('Transfer', vapiCallUuid, 'status: ', res);}
  });

}

//=========================================

const port = process.env.PORT || 8000;

app.listen(port, () => console.log(`Voice API application listening on port ${port}!`));

//------------
