'use strict';

require('dotenv').config({
  silent: true
});

const express = require('express'); // app server
const bodyParser = require('body-parser'); // parser for post requests
const numeral = require('numeral');
const fs = require('fs'); // file system for loading JSON

const AssistantV1 = require('watson-developer-cloud/assistant/v1');
const DiscoveryV1 = require('watson-developer-cloud/discovery/v1');


const assistant = new AssistantV1({ version: '2018-09-20' });
const discovery = new DiscoveryV1({ version: '2018-10-15' });


const WatsonDiscoverySetup = require('./lib/watson-discovery-setup');
const WatsonAssistantSetup = require('./lib/watson-assistant-setup');

const DEFAULT_NAME = 'Acarya Trial ChatBot';
const DISCOVERY_ACTION = 'RnR'; // Replaced RnR w/ Discovery but Assistant action is still 'rnr'.
const DISCOVERY_DOCS = [];


const app = express();

// Bootstrap application settings
app.use(express.static('./public')); // load UI from public folder
app.use(bodyParser.json());

// setupError will be set to an error message if we cannot recover from service setup or init error.
let setupError = '';

let discoveryParams; // discoveryParams will be set after Discovery is validated and setup.
const discoverySetup = new WatsonDiscoverySetup(discovery);
const discoverySetupParams = { default_name: DEFAULT_NAME, documents: DISCOVERY_DOCS };
discoverySetup.setupDiscovery(discoverySetupParams, (err, data) => {
	if (err) {
		handleSetupError(err);
	} else {
		console.log('Discovery is ready!');
		discoveryParams = data;
	}
});



let workspaceID; // workspaceID will be set when the workspace is created or validated.
const assistantSetup = new WatsonAssistantSetup(assistant);
const assistantSetupParams = { default_name: DEFAULT_NAME };
assistantSetup.setupAssistantWorkspace(assistantSetupParams, (err, data) => {
	if (err) {
		handleSetupError(err);
	} else {
		console.log('Watson Assistant is ready!');
		workspaceID = data;
	}
});


// Endpoint to be called from the client side
app.post('/api/message', function(req, res) {
	if (setupError) {
		return res.json({ output: { text: 'The app failed to initialize properly. Setup and restart needed.' + setupError } });
	}

	if (!workspaceID) {
		return res.json({
			output: {
				text: 'Assistant initialization in progress. Please try again.'
			}
		});
	}

	const payload = {
		workspace_id: workspaceID,
		context: {},
		input: {}
    };

	if (req.body) {
		if (req.body.input) {
            payload.input = req.body.input;
        }
        if (req.body.context) {
            // The client must maintain context/state
            payload.context = req.body.context;
        }
    }


	assistant.message(payload, function(err, data) {
		if (err) {
            return res.status(err.code || 500).json(err);
        } else {
			console.log('assistant.message :: ', JSON.stringify(data));
            // lookup actions
            callDiscovery(data, function(err, data) {
                if (err) {
					return res.status(err.code || 500).json(err);
                } else {
					return res.json(data);
                }
            });
        }
    });




});

/**
 * Looks for actions requested by Assistant service and provides the requested data.
 */
function callDiscovery(data, callback) {
	console.log('callDiscovery');
	
	let numberOfResponses = 3;
 
	//Test
	if (data.context && data.context.action) {
		const payload = {
			workspace_id: workspaceID,
			context: data.context,
			input: data.input
		};

		// Assistant requests a data lookup action
		if (data.context.action == 'DISCOVERY_ACTION') {
			console.log('************** Discovery *************** InputText : ' + payload.input.text);
			let discoveryResponse = '';
	

			if (!discoveryParams) {
				console.log('Discovery is not ready for query.');
				discoveryResponse = 'Sorry, currently I do not have a response. Discovery initialization is in progress. Please try again later.';
				if (data.output.text) {
					data.output.text.push(discoveryResponse);
				}
				// Clear the context's action since the lookup and append was attempted.
				data.context.action = {};
				callback(null, data);
				// Clear the context's action since the lookup was attempted.
				payload.context.action = {};
			} else {
				const queryParams = {
					natural_language_query: payload.input.text,
					passages: true
				};
			
				Object.assign(queryParams, discoveryParams);
				discovery.query(queryParams, (err, searchResponse) => {
					discoveryResponse = 'Problems ....';
					if (err) {
						console.error('Error searching for documents: ' + err);
						
						if (data.output.text) {
							data.output.text.push(discoveryResponse);
						}
							
					} else if (searchResponse.passages.length > 0) {
						
						for (var j = 0; j < numberOfResponses; j++) { 
							
							const bestPassage = searchResponse.passages[j];
							
							const discoveryResponse = ('proposition' + (j+1) + ': ' + bestPassage.passage_text);
							
							console.log('bestPassage Stringnified: ' + JSON.stringify(bestPassage));
							

							console.log('Passage score: ', bestPassage.passage_score);
							console.log('Passage text: ', bestPassage.passage_text);


							
							if (data.output.text) {
								data.output.text.push(discoveryResponse);
								data.output.text.push("");
							}
						}
						
					}

			  
					// Clear the context's action since the lookup and append was completed.
					data.context.action = {};
					callback(null, data);
					// Clear the context's action since the lookup was completed.
					payload.context.action = {};
				});
			}
		} else {
		  callback(null, data);
		  return;
		}
	} else {
		callback(null, data);
		return;
	}
}

/**
 * Handle setup errors by logging and appending to the global error text.
 * @param {String} reason - The error message for the setup error.
 */
function handleSetupError(reason) {
  setupError += ' ' + reason;
  console.error('The app failed to initialize properly. Setup and restart needed.' + setupError);
  // We could allow our chatbot to run. It would just report the above error.
  // Or we can add the following 2 lines to abort on a setup error allowing Bluemix to restart it.
  console.error('\nAborting due to setup error!');
  process.exit(1);
}

module.exports = app;




