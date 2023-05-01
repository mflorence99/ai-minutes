import { input } from '@inquirer/prompts';

import speech from '@google-cloud/speech';

const client = new speech.SpeechClient();

const dir = await input({ message: 'Enter directory of minutes' });

// The path to the remote LINEAR16 file
const gcsUri = 'gs://cloud-samples-data/speech/brooklyn_bridge.raw';

// The audio file's encoding, sample rate in hertz, and BCP-47 language code
const audio = {
  uri: gcsUri
};
const config = {
  encoding: 'LINEAR16',
  sampleRateHertz: 16000,
  languageCode: 'en-US'
};
const request = {
  audio: audio,
  config: config
};

// Detects speech in the audio file
const [response] = await client.recognize(request as any);
const transcription = response.results
  .map((result) => result.alternatives[0].transcript)
  .join('\n');
console.log(`Transcription: ${transcription}`);
