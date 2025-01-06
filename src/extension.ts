import * as vscode from 'vscode';
import { BASE_PROMPT, EXERCISES_PROMPT, FETCH_PROMPT } from './prompts';
import { DataService } from './services/data.service';
import { logger } from './logger';

export function activate(context: vscode.ExtensionContext) {
	logger.appendLine('Talan extension is now active');
	const dataService = new DataService(context);

	// Register clear cache command
	const clearCacheCommand = vscode.commands.registerCommand('talan.clearCache', async () => {
		logger.appendLine('Executing clear cache command');
		const url = await vscode.window.showInputBox({
			prompt: 'Enter URL to clear cache for',
			placeHolder: 'https://example.com'
		});
		if (url) {
			logger.appendLine(`Clearing cache for URL: ${url}`);
			await dataService.clearCache(url);
			vscode.window.showInformationMessage(`Cache cleared for ${url}`);
			logger.appendLine('Cache cleared successfully');
		} else {
			logger.appendLine('Clear cache cancelled - no URL provided');
		}
	});
	context.subscriptions.push(clearCacheCommand);

	// define a chat handler
	const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => {
		logger.appendLine(`Processing chat request - Command: ${request.command || 'default'}`);

		// initialize the prompt
		let prompt = BASE_PROMPT;

		if (request.command === 'exercise') {
			logger.appendLine('Using exercise prompt');
			prompt = EXERCISES_PROMPT;
		} else if (request.command === 'cache') {
			logger.appendLine('Using cache command');
			try {
				// Extract URL from prompt using regex
				const defaultUrl = 'https://thinhdanggroup.github.io/';
				const urlRegex = /(https?:\/\/[^\s]+)/g;
				const matches = request.prompt.match(urlRegex);
				const url = matches ? matches[0] : defaultUrl;
				
				logger.appendLine(`Attempting to cache data from URL: ${url}`);
				await dataService.fetchData(url); // This will automatically cache the data
				await stream.markdown(`Successfully cached data from ${url}`);
				return;
			} catch (error) {
				logger.appendLine(`Error during cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
				if (error instanceof Error) {
					await stream.markdown(`Error: ${error.message}`);
				} else {
					await stream.markdown('An unexpected error occurred');
				}
				return;
			}
		} else if (request.command === 'ask') {
			logger.appendLine('Using ask command');
			try {
				// Get all cached data
				const cachedData = await dataService.getAllCachedData();
				if (cachedData.length === 0) {
					await stream.markdown('No cached data available. Please use /cache command to cache some data first.');
					return;
				}

				// Create reference context from all cached data
				const referenceContext = cachedData.map(item => 
					`Document from ${item.url}:\n<reference>${item.content}</reference>`
				).join('\n\n');

				// Initialize messages with base prompt
				const messages = [
					vscode.LanguageModelChatMessage.User(FETCH_PROMPT),
					vscode.LanguageModelChatMessage.Assistant('Here are the reference documents:\n' + referenceContext),
					vscode.LanguageModelChatMessage.User(`Please answer this question using the reference documents above: ${request.prompt}`)
				];

				// Send request to model
				const chatResponse = await request.model.sendRequest(messages, {}, token);

				// Stream the response
				for await (const fragment of chatResponse.text) {
					stream.markdown(fragment);
				}
				return;
			} catch (error) {
				logger.appendLine(`Error during ask command: ${error instanceof Error ? error.message : 'Unknown error'}`);
				if (error instanceof Error) {
					await stream.markdown(`Error: ${error.message}`);
				} else {
					await stream.markdown('An unexpected error occurred');
				}
				return;
			}
		} else if (request.command === 'fetch') {
			logger.appendLine('Using fetch prompt');
			try {
				prompt = FETCH_PROMPT;
				// Extract URL from prompt using regex
				const defaultUrl = 'https://thinhdanggroup.github.io/';
				const urlRegex = /(https?:\/\/[^\s]+)/g;
				const matches = request.prompt.match(urlRegex);
				const url = matches ? matches[0] : defaultUrl;
				
				logger.appendLine(`Attempting to fetch data from URL: ${url}`);

				const data = await dataService.fetchData(url);
				logger.appendLine('Data fetched successfully');
				const messages = [
					vscode.LanguageModelChatMessage.User(prompt),
				];
				messages.push(vscode.LanguageModelChatMessage.Assistant(`This is reference document with url ${url}: <reference>${data}</reference>`));
				messages.push(vscode.LanguageModelChatMessage.User(`Please answer this question: ${request.prompt}`));

				// stream.markdown(all_messages_markdown);
				const chatResponse = await request.model.sendRequest(messages, {}, token);

				// stream the response
				for await (const fragment of chatResponse.text) {
					stream.markdown(fragment);
				}
				return;
			} catch (error) {
				logger.appendLine(`Error during fetch: ${error instanceof Error ? error.message : 'Unknown error'}`);
				if (error instanceof Error) {
					await stream.markdown(`Error: ${error.message}`);
				} else {
					await stream.markdown('An unexpected error occurred');
				}
				return;
			}
		}

		// initialize the messages array with the prompt
		const messages = [
			vscode.LanguageModelChatMessage.User(prompt),
		];

		// get all the previous participant messages
		const previousMessages = context.history.filter(
			(h) => h instanceof vscode.ChatResponseTurn
		);

		// add the previous messages to the messages array
		previousMessages.forEach((m) => {
			let fullMessage = '';
			m.response.forEach((r) => {
				const mdPart = r as vscode.ChatResponseMarkdownPart;
				fullMessage += mdPart.value.value;
			});
			messages.push(vscode.LanguageModelChatMessage.Assistant(fullMessage));
		});

		// add in the user's message
		messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

		// send the request
		logger.appendLine('Sending chat request to model');
		const chatResponse = await request.model.sendRequest(messages, {}, token);

		// stream the response
		logger.appendLine('Streaming chat response');
		for await (const fragment of chatResponse.text) {
			stream.markdown(fragment);
		}
		logger.appendLine('Chat response completed');

		return;

	};

	// create participant
	logger.appendLine('Creating chat participant');
	const tutor = vscode.chat.createChatParticipant("thinhda.talan", handler);

	// add icon to participant
	tutor.iconPath = vscode.Uri.joinPath(context.extensionUri, 'talan.png');
	logger.appendLine('Chat participant created and configured');
}

export function deactivate() {
	logger.appendLine('Talan extension is being deactivated');
	logger.dispose();
}
