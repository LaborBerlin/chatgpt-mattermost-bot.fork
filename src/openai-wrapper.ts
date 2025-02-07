import {
    OpenAI, ClientOptions
} from "openai";

import {openAILog as log} from "./logging"

import {PluginBase} from "./plugins/PluginBase";
import {AiResponse, MessageData} from "./types";

const apiKey = process.env['OPENAI_API_KEY'];
const basePath = process.env['OPENAI_API_BASE'];
log.trace({apiKey, basePath})

const configuration: ClientOptions = { apiKey: apiKey, baseURL: basePath }

const openai = new OpenAI(configuration)

const model = process.env['OPENAI_MODEL_NAME'] ?? 'gpt-3.5-turbo'
const max_tokens = Number(process.env['OPENAI_MAX_TOKENS'] ?? 2000)
const temperature = Number(process.env['OPENAI_TEMPERATURE'] ?? 1)
const reasoning_effort: OpenAI.Chat.Completions.ChatCompletionReasoningEffort = (process.env['OPENAI_REASONING_EFFORT'] ?? 'medium') as OpenAI.Chat.Completions.ChatCompletionReasoningEffort

log.debug({model, max_tokens, temperature})

const plugins: Map<string, PluginBase<any>> = new Map()
const functions: OpenAI.Chat.Completions.ChatCompletionTool[] = []

/**
 * Registers a plugin as a GPT function. These functions are sent to openAI when the user interacts with chatGPT.
 * @param plugin
 */
export function registerChatPlugin(plugin: PluginBase<any>) {
    plugins.set(plugin.key, plugin)
    functions.push({
        type: "function",
        function: {
            name: plugin.key,
            description: plugin.description,
            parameters: {
                type: 'object',
                properties: plugin.pluginArguments,
                required: plugin.requiredArguments
            }
        },
    })
}

/**
 * Sends a message thread to chatGPT. The response can be the message responded by the AI model or the result of a
 * plugin call.
 * @param messages The message thread which should be sent.
 * @param msgData The message data of the last mattermost post representing the newest message in the message thread.
 */
export async function continueThread(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], msgData: MessageData): Promise<AiResponse> {
    let aiResponse: AiResponse = {
        message: 'Sorry, but it seems I found no valid response.'
    }

    // the number of rounds we're going to run at maximum
    let maxChainLength = 7;

    // check whether ChatGPT hallucinates a plugin name.
    const missingPlugins = new Set<string>()

    let isIntermediateResponse = true
    while(isIntermediateResponse && maxChainLength-- > 0) {
        const responseMessage = await createChatCompletion(messages, functions)
        log.trace(responseMessage)
        if(responseMessage) {
            // if the function_call is set, we have a plugin call
            if(responseMessage.tool_calls) {
                // we just take the first tool call – TODO: check if there may be more than one tool call per response
                const function_call = responseMessage.tool_calls[0].function
                const pluginName = function_call.name
                log.trace({pluginName})
                try {
                    const plugin = plugins.get(pluginName);
                    if (plugin){
                        const pluginArguments = JSON.parse(function_call.arguments ?? '[]');
                        log.trace({plugin, pluginArguments})
                        const pluginResponse = await plugin.runPlugin(pluginArguments, msgData)
                        log.trace({pluginResponse})

                        if(pluginResponse.intermediate) {
                            messages.push({
                                role: 'function',
                                name: pluginName,
                                content: pluginResponse.message
                            })
                            continue
                        }
                        aiResponse = pluginResponse
                    } else {
                        if (!missingPlugins.has(pluginName)){
                            missingPlugins.add(pluginName)
                            log.debug({ error: 'Missing plugin ' + pluginName, pluginArguments: function_call.arguments})
                            messages.push({ role: 'system', content: `There is no plugin named '${pluginName}' available. Try without using that plugin.`})
                            continue
                        } else {
                            log.debug({ messages })
                            aiResponse.message = `Sorry, but it seems there was an error when using the plugin \`\`\`${pluginName}\`\`\`.`
                        }
                    }
                } catch (e) {
                    log.debug({ messages, error: e })
                    aiResponse.message = `Sorry, but it seems there was an error when using the plugin \`\`\`${pluginName}\`\`\`.`
                }
            } else if(responseMessage.content) {
                aiResponse.message = responseMessage.content
            }
        }

        isIntermediateResponse = false
    }

    return aiResponse
}

/**
 * Creates a openAI chat model response.
 * @param messages The message history the response is created for.
 * @param functions Function calls which can be called by the openAI model
 */
export async function createChatCompletion(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], functions: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined = undefined): Promise<OpenAI.Chat.Completions.ChatCompletionMessage | undefined> {
    const chatCompletionOptions: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
        model: model,
        messages: messages,
        max_tokens: max_tokens,
        temperature: temperature,
        reasoning_effort: reasoning_effort,
        tools: functions,
        tool_choice: 'none',
    }
    if(functions) {
        chatCompletionOptions.tool_choice = 'auto'
    }

    log.trace({chatCompletionOptions})

    const chatCompletion = await openai.chat.completions.create(chatCompletionOptions)

    log.trace({chatCompletion})

    return chatCompletion.choices?.[0]?.message
}

/**
 * Creates a openAI DALL-E response.
 * @param prompt The image description provided to DALL-E.
 */
export async function createImage(prompt: string): Promise<string | undefined> {
    const createImageOptions: OpenAI.Images.ImageGenerateParams = {
        prompt,
        n: 1,
        size: '512x512',
        response_format: 'b64_json'
    };
    log.trace({createImageOptions})
    const image = await openai.images.generate(createImageOptions)
    log.trace({image})
    return image.data[0]?.b64_json
}