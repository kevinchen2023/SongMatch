// ASK SDK
const Alexa = require('ask-sdk-core');
// ASK SDK adapter to connecto to Amazon S3
const persistenceAdapter = require('ask-sdk-s3-persistence-adapter');
// i18n library dependency, we use it below in a localisation interceptor
const i18n = require('i18next');
// We import a language strings object containing all of our strings.
// The keys for each string will then be referenced in our code, e.g. handlerInput.t('WELCOME_MSG')
const languageStrings = require('./languageStrings');
// We will use the moment.js package in order to make sure that we calculate the date correctly
const moment = require('moment-timezone');

/////////////////////////////////
// Handlers Definition
/////////////////////////////////

/**
 * LaunchRequestHandler. Responds to a launch, or a call to start over.
 */
const LaunchRequestHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest'
               || request.intent.name === "AMAZON.StartOverIntent";
    },
    handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak(welcomeMessage)
            .reprompt(repromptSpeech)
            .getResponse();
    }
};

/**
 * BeginQuizIntentHandler begins the quiz when 
 * the user gives the name of an artist. Proceeds to ask the first question.
 */
const BeginQuizIntentHandler =  {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'BeginQuizIntent' ;
    },
    handle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        const responseBuilder = handlerInput.responseBuilder;
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        
        //keeps track of which question we're on
        attributes.numQuestions = 0; 
        //stores the 5 user properties we want to keep track of throughout the quiz.
        attributes.userValues = {"Danceability": 0.0, "Energy": 0.0, "Valence": 0.0, "Instrumentalness": 0.0, "Speechiness": 0.0}; 
        
        const artistName = handlerInput.requestEnvelope.request.intent.slots.artist.value;
        
        //message if artist's name starts with a vowel
        const startQuizMessage1 = `Great. ` + artistName + `. Now please respond to 
                                   these four questions to help me match you to an ` 
                                   + artistName + ` song. First, how jittery do you 
                                   feel right now? Super jittery, kinda buzzed, neutral, 
                                   kinda tired, or about to pass out?`;
        
        //message if artist's name starts with a consonant
        const startQuizMessage2 = `Great. ` + artistName + `. Now please respond to 
                                   these four questions to help me match you to a ` 
                                   + artistName + ` song. First, how jittery do you feel 
                                   right now? Super jittery, kinda buzzed, neutral, kinda 
                                   tired, or about to pass out?`;
        
        let firstChar = artistName.charAt(0);
        
        if (['a', 'e', 'i', 'o', 'u'].indexOf(firstChar.toLowerCase()) !== -1) {
            return responseBuilder
            .speak(startQuizMessage1)
            .reprompt(repromptSpeech)
            .getResponse();
        } else {
            return responseBuilder
            .speak(startQuizMessage2)
            .reprompt(repromptSpeech)
            .getResponse();
        }
    },
};

/**
 * AnswerIntentHandler responds to answers given by the user. Updates 
 * appropriate user attributes, and asks the next question, unless 
 * all questions have been asked. If so, the song match is given back to the user.
 */
const AnswerIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'AnswerIntent';
    },
    handle(handlerInput) {
        let attributes = handlerInput.attributesManager.getSessionAttributes();
        
        let userResponse;
        
        //these statements capture the answer response given by the user
        if (attributes.numQuestions === 0) {
            userResponse = handlerInput.requestEnvelope.request.intent.slots.firstquestion.value;
        }
        if (attributes.numQuestions === 1) {
            userResponse = handlerInput.requestEnvelope.request.intent.slots.secondandthirdquestion.value;
        }
        if (attributes.numQuestions === 2) {
            userResponse = handlerInput.requestEnvelope.request.intent.slots.secondandthirdquestion.value;
        }
        if (attributes.numQuestions === 3) {
            userResponse = handlerInput.requestEnvelope.request.intent.slots.fourthquestion.value;
        }
        
        //updates the userValues attribute based on what question was asked and what answer was given.
        attributes.userValues = updateScores(attributes.userValues, attributes.numQuestions, userResponse);
        
        //If we are not done with the quiz yet - we haven't gone through all the questions yet. Otherwise, calculate stats and return songMatch.
        if (attributes.numQuestions < questionList.length - 1) {
            attributes.numQuestions++;
            let questionContent = questionList[attributes.numQuestions].speech;
            return handlerInput.responseBuilder
            .speak("Got it. Next question. " + questionContent)
            .reprompt(repromptSpeech)
            .getResponse();
        } else { //if all the questions have been asked
            let normalizedUserValues = normalizeScores(attributes.userValues); //normalize user values
            let songMatch = getMostSimilarSong(0, normalizedUserValues, songList); //uses cosine similarity technique to get the most similar song
            return handlerInput.responseBuilder
            .speak("Based on your answers, your Song Match is " 
                    + songMatch + ". Would you like to get another Song Match with a different artist? Yay or nay.")
            .reprompt("Did you say yay or nay?")
            .getResponse();
        }
        
    }
};

/**
 * RunItBackIntentHandler tells Alexa whether to start over the game or not. 
 * If the user responds "Yay" and wants to play another game, Alexa 
 * prompts the user to give her another artist. If the user says "Nay", the skil exits.
 */
const RunItBackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'RunItBackIntent';
    },
    handle(handlerInput) {
        let finalMessage;
        if (handlerInput.requestEnvelope.request.intent.slots.runitback.value === "yay") {
            finalMessage = "Cool. Please give me the name of another one of your favorite artists.";
        } else {
            finalMessage = exitSkillMessage;
        }
        return handlerInput.responseBuilder
            .speak(finalMessage)
            .reprompt(repromptSpeech)
            .getResponse();
    }
};

/**
 * Built in intent handler.
 */
const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = handlerInput.t('HELP_MSG');

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

/**
 * Built in intent handler.
 */
const PauseIntentHandler =  {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.PauseIntent' ;
    },
    handle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        const responseBuilder = handlerInput.responseBuilder;
        let sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

        let say = 'Hello from AMAZON.PauseIntent. ';

        return responseBuilder
            .speak(say)
            .reprompt('try again, ' + say)
            .getResponse();
    },
};

/**
 * Built in intent handler.
 */
const NavigateHomeIntentHandler =  {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.NavigateHomeIntent' ;
    },
    handle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        const responseBuilder = handlerInput.responseBuilder;
        let sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

        let say = 'Hello from AMAZON.NavigateHomeIntent. ';

        return responseBuilder
            .speak(say)
            .reprompt('try again, ' + say)
            .getResponse();
    },
};

/**
 * Built in intent handler.
 */
const RepeatIntentHandler =  {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.RepeatIntent' ;
    },
    handle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        const responseBuilder = handlerInput.responseBuilder;
        let sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

        let previousSpeech = getPreviousSpeechOutput(sessionAttributes);

        return responseBuilder
            .speak('sure, I said, ' + stripSpeak(previousSpeech.outputSpeech))
            .reprompt(stripSpeak(previousSpeech.reprompt))
            .getResponse();
    },
};

/**
 * Built in intent handler.
 */
const ResumeIntentHandler =  {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.ResumeIntent' ;
    },
    handle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        const responseBuilder = handlerInput.responseBuilder;
        let sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

        let say = 'Hello from AMAZON.ResumeIntent. ';

        return responseBuilder
            .speak(say)
            .reprompt('try again, ' + say)
            .getResponse();
    },
};

/**
 * Built in intent handler.
 */
const StartOverIntentHandler =  {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.StartOverIntent' ;
    },
    handle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        const responseBuilder = handlerInput.responseBuilder;
        let sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

        let say = 'Hello from AMAZON.StartOverIntent. ';

        return responseBuilder
            .speak(say)
            .reprompt('try again, ' + say)
            .getResponse();
    },
};

/**
 * Handles AMAZON.CancelIntent & AMAZON.StopIntent requests sent by Alexa 
 * Note : this request is sent when the user makes a request that corresponds to AMAZON.CancelIntent & AMAZON.StopIntent intents defined in your intent schema.
 */
const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speakOutput = handlerInput.t('GOODBYE_MSG');

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

/* *
 * SessionEndedRequest notifies that a session was ended. This handler will be triggered when a currently open 
 * session is closed for one of the following reasons: 1) The user says "exit" or "quit". 2) The user does not 
 * respond or says something that does not match an intent defined in your voice model. 3) An error occurs 
 * */
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        return handlerInput.responseBuilder.getResponse();
    }
};

/* *
 * The intent reflector is used for interaction model testing and debugging.
 * It will simply repeat the intent the user said. You can create custom handlers for your intents 
 * by defining them above, then also adding them to the request handler chain below 
 * */
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = handlerInput.t('REFLECTOR_MSG', { intentName: intentName });

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

/**
 * Generic error handling to capture any syntax or routing errors. If you receive an error
 * stating the request handler chain is not found, you have not implemented a handler for
 * the intent being invoked or included it in the skill builder below 
 * */
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`~~~~ Error handled: ${error.message}`);
        const speakOutput = handlerInput.t('ERROR_MSG');

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

// 2. Constants ===========================================================================
    
    //Generic messages
    const welcomeMessage = `Welcome to Song Match. I can help you understand which song by your favorite artist best fits you. Please tell me the name of your favorite artist.`;
    const exitSkillMessage = `Thank you for using Song Match. For another great skill, check out Song Quiz!`;
    const repromptSpeech = `Sorry, I didn't hear that answer. Could you say that again?`;
    const helpMessage = `I can tell you what song by your favorite artist matches you the best. Give me your favorite artist, take a quiz, then bam! A match!`;
    
    //Creates the 4 questions, and loads them into an array
    const question1 = createQuestion1();
    const question2 = createQuestion2();
    const question3 = createQuestion3();
    const question4 = createQuestion4();
    question1.speech = `How jittery do you feel right now? Super jittery, kinda buzzed, neutral, kinda tired, or about to pass out?`;
    question2.speech = `Is life always good, no matter what? Yes or no.`;
    question3.speech = `Important one, is cereal a soup? Yes or no`;
    question4.speech = `Hard rap, hip hop, or lofi beats to study to?`;
    const questionList = loadQuestionList();
    
    /**
     * Since I haven't figured out how to integrate the Spotify API (having trouble with authentication tokens), 
     * I made up 10 songs with DEVIS values for the purpose of testing my algorithm. Danceability, Energy, Valence, 
     * Instrumentalness, Speechiness are all properties every song on Spotify has, with values ranging from 0 to 1. 
     * For the purpose of testing my algorithm, I gave each of these songs my own DEVIS values based off what I think of each song.
     */
    const song0 = {"Danceability": 0.25, "Energy": 0.30, "Valence": 0.7, "Instrumentalness": 0.15, "Speechiness": 0.4}; 
    song0.name = "Loving is Easy by Rex Orange County";
    const song1 = {"Danceability": 0.9, "Energy": 0.8, "Valence": 0.9, "Instrumentalness": 0.5, "Speechiness": 0.6};
    song1.name = "Dancing Queen by ABBA";
    const song2 = {"Danceability": 0.75, "Energy": 0.85, "Valence": 0.85, "Instrumentalness": 0.45, "Speechiness": 0.35};
    song2.name = "Dynamite by Taio Cruz";
    const song3 = {"Danceability": 0.21, "Energy": 0.42, "Valence": 0.65, "Instrumentalness": 0.2, "Speechiness": 0.3};
    song3.name = "Hey Jude by the Beatles";
    const song4 = {"Danceability": 0.1, "Energy": 0.2, "Valence": 0.35, "Instrumentalness": 0.2, "Speechiness": 0.4};
    song4.name = "La la land by Bryce Vine";
    const song5 = {"Danceability": 0.5, "Energy": 0.1, "Valence": 0.02, "Instrumentalness": 0.1, "Speechiness": 0.1};
    song5.name = "Slow dancing in the dark by Joji";
    const song6 = {"Danceability": 0.75, "Energy": 0.75, "Valence": 0.63, "Instrumentalness": 0.55, "Speechiness": 0.61};
    song6.name = "God's Plan by Drake";
    const song7 = {"Danceability": 0.5, "Energy": 0.8, "Valence": 0.65, "Instrumentalness": 0.1, "Speechiness": 0.3};
    song7.name = "Nonstop by Drake";
    const song8 = {"Danceability": 0.75, "Energy": 0.8, "Valence": 0.55, "Instrumentalness": 0.9, "Speechiness": 0.9};
    song8.name = "Venetia by Lil Uzi Vert";
    const song9 = {"Danceability": 0.2, "Energy": 0.45, "Valence": 0.65, "Instrumentalness": 0.44, "Speechiness": 0.3};
    song9.name = "Sundress by A$AP Rocky";
    
    //Loads these 10 songs into an array. 
    const songList = loadSongList();

    
// 3.  Helper Functions ===================================================================

/**
 * Updates the attributes.userValues field with 
 * new DEVIS values after the user has 
 * responded to one question.
 */
function updateScores(userValues, questionNumber, userResponse) {
    let currQuestion = questionList[questionNumber];
    for (let key in currQuestion["question"][userResponse]) {
        userValues[key] += currQuestion["question"][userResponse][key];
    }
    return userValues;
}

/**
 * Determines the normalizing factor by finding the magnitude of 
 * the user's accumulated DEVIS scores, then divides every 
 * original entry by this factor to create a normalized set 
 * of accumulated user response values, or a song's DEVIS 
 * values. Returns this set.
 */
function normalizeScores(values) {
    let normalizingFactor = 0;
    for (let key in values) {
        if (key !== "name") { //for songs, one of the keys is the name of the song, which I don't want to process. 
            let value = values[key];
            normalizingFactor += value * value;
        }
    }
    normalizingFactor = Math.sqrt(normalizingFactor);
    for (let key in values) {
        if (key !== "name") {
            values[key] /= normalizingFactor;
        }
    }
    return values;
}

/**
 * Takes in the normalized attributes.userValues, and then goes through 
 * every song in songList to see which song gives the largest similarity score. 
 * Takes in bestSoFar, which keeps track of the highest similarity score so far.
 * Similarity scores range from 0 to 1, from least similar to most 
 * similar. Returns the name of the most similar song.
 */
function getMostSimilarSong(bestSoFar, normalizedUserValues, songList) {
    let songMatch;
    for (let i = 0; i < songList.length; i++) {
        let normalizedSongValues = normalizeScores(songList[i]); //normalize the song's DEVIS values too, before comparing with normalizedUserValues
        let currentSimilarity = calculateSimilarity(normalizedUserValues, normalizedSongValues); //currentSimilarity range: [0, 1]
        if (currentSimilarity >= bestSoFar) {
            bestSoFar = currentSimilarity;
            songMatch = songList[i];
        }
    }
    return songMatch.name;
}

/**
 * Calculates the similarity between the user's values and 
 * the values of a certain song. The closer the result is 
 * to 1, the more similar the song is to the user.
 */
function calculateSimilarity(userValues, songValues) {
    let similarity = 0; //cannot be lower than this number. Mathematically, similarities can be from 0 to 1, inclusive.
    for (let key in userValues) {
        similarity += userValues[key] * songValues[key];
    }
    return similarity;
}

/**
 * Loads 10 songs to an array, and returns it.
 */
function loadSongList() {
    let songList = [];
    songList.push(song0);
    songList.push(song1);
    songList.push(song2);
    songList.push(song3);
    songList.push(song4);
    songList.push(song5);
    songList.push(song6);
    songList.push(song7);
    songList.push(song8);
    songList.push(song9);
    return songList;
}

/**
 * Loads the 4 questions to be asked to an array, and returns it.
 */
function loadQuestionList() {
    let questionList = [];
    questionList.push(question1);
    questionList.push(question2);
    questionList.push(question3);
    questionList.push(question4);
    return questionList;
}

/**
 * Creates the first question. Each question is a multi-level dictionary. 
 * The outer dictionary maps to an inner dictionary, each of which has keys 
 * that map to a final dictionary of DEVIS properties corresponding to associated values.
 * Basically, each of the possible responses to the question are stored as dictionaries 
 * that map to unique DEVIS values for that response, as you can see in the code.
 * 
 */
function createQuestion1() {
    let fillDict = {};
    let innerDict = {};
    innerDict["super jittery"] = {"Danceability": 0.9, "Energy": 0.8, "Valence": 0.5, "Instrumentalness": 0.8, "Speechiness": 0.75};
    innerDict["kinda buzzed"] = {"Danceability": 0.7, "Energy": 0.65, "Valence": 0.5, "Instrumentalness": 0.65, "Speechiness": 0.62};
    innerDict["neutral"] = {"Danceability": 0.5, "Energy": 0.5, "Valence": 0.5, "Instrumentalness": 0.5, "Speechiness": 0.5};
    innerDict["kinda tired"] = {"Danceability": 0.35, "Energy": 0.25, "Valence": 0.5, "Instrumentalness": 0.25, "Speechiness": 0.3};
    innerDict["about to pass out"] = {"Danceability": 0.0, "Energy": 0.0, "Valence": 0.5, "Instrumentalness": 0.8, "Speechiness": 0.1};
    fillDict["question"] = innerDict;
    return fillDict;
}

/**
 * Creates the second question. 
 */
function createQuestion2() {
    let fillDict = {};
    let innerDict = {};
    innerDict["yes"] = {"Danceability": 0.8, "Energy": 0.6, "Valence": 0.9, "Instrumentalness": 0.5, "Speechiness": 0.6};
    innerDict["no"] = {"Danceability": 0.15, "Energy": 0.2, "Valence": 0.05, "Instrumentalness": 0.5, "Speechiness": 0.4};
    fillDict["question"] = innerDict;
    return fillDict;
}

/**
 * Creates the third question. 
 */
function createQuestion3() {
    let fillDict = {};
    let innerDict = {};
    innerDict["yes"] = {"Danceability": 0.45, "Energy": 0.89, "Valence": 0.12, "Instrumentalness": 0.33, "Speechiness": 0.77};
    innerDict["no"] = {"Danceability": 0.55, "Energy": 0.11, "Valence": 0.88, "Instrumentalness": 0.67, "Speechiness": 0.23};
    fillDict["question"] = innerDict;
    return fillDict;
}

/**
 * Creates the fourth question. 
 */
function createQuestion4() {
    let fillDict = {};
    let innerDict = {};
    innerDict["hard rap"] = {"Danceability": 0.85, "Energy": 0.75, "Valence": 0.55, "Instrumentalness": 0.15, "Speechiness": 0.8};
    innerDict["hip hop"] = {"Danceability": 0.55, "Energy": 0.45, "Valence": 0.5, "Instrumentalness": 0.55, "Speechiness": 0.5};
    innerDict["lofi beats to study to"] = {"Danceability": 0.25, "Energy": 0.15, "Valence": 0.45, "Instrumentalness": 0.95, "Speechiness": 0.2};
    fillDict["question"] = innerDict;
    return fillDict;
}

/**
 * Built in helper function for the built in intent: repeat
 */
function stripSpeak(str) { 
    return(str.replace('<speak>', '').replace('</speak>', '')); 
} 

/**
 * Built in helper function for the built in intent: repeat
 */
function getPreviousSpeechOutput(attrs) { 
 
    if (attrs.lastSpeechOutput && attrs.history.length > 1) { 
        return attrs.lastSpeechOutput; 
 
    } else { 
        return false; 
    } 
 
} 

/////////////////////////////////
// Interceptors Definition
/////////////////////////////////

/**
 * This request interceptor will log all incoming requests in the associated Logs (CloudWatch) of the AWS Lambda functions
 */
const LoggingRequestInterceptor = {
    process(handlerInput) {
        console.log("\n" + "********** REQUEST *********\n" +
            JSON.stringify(handlerInput, null, 4));
    }
};

/**
 * This response interceptor will log outgoing responses if any in the associated Logs (CloudWatch) of the AWS Lambda functions
 */
const LoggingResponseInterceptor = {
    process(handlerInput, response) {
        if (response) console.log("\n" + "************* RESPONSE **************\n"
            + JSON.stringify(response, null, 4));
    }
};

/**
 * This request interceptor will bind a translation function 't' to the handlerInput
 */
const LocalisationRequestInterceptor = {
    process(handlerInput) {
        i18n.init({
            lng: Alexa.getLocale(handlerInput.requestEnvelope),
            resources: languageStrings
        }).then((t) => {
            handlerInput.t = (...args) => t(...args);
        });
    }
};

/////////////////////////////////
// SkillBuilder Definition
/////////////////////////////////

/**
 * The SkillBuilder acts as the entry point for your skill, routing all request and response
 * payloads to the handlers above. Make sure any new handlers or interceptors you've
 * defined are included below. The order matters - they're processed top to bottom.
 */
exports.handler = Alexa.SkillBuilders.custom()
    .withPersistenceAdapter(
        new persistenceAdapter.S3PersistenceAdapter({ bucketName: process.env.S3_PERSISTENCE_BUCKET })
    )
    .addRequestHandlers(
        LaunchRequestHandler,
        BeginQuizIntentHandler,
        AnswerIntentHandler,
        RunItBackIntentHandler,
        HelpIntentHandler,
        PauseIntentHandler,
        NavigateHomeIntentHandler,
        RepeatIntentHandler,
        ResumeIntentHandler,
        StartOverIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(
        ErrorHandler)
    .addRequestInterceptors(
        LocalisationRequestInterceptor,
        LoggingRequestInterceptor,
    )
    .addResponseInterceptors(
        LoggingResponseInterceptor)
    .withApiClient(new Alexa.DefaultApiClient())
    .lambda();