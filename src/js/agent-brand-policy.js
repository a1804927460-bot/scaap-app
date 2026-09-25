'use strict';

const MESSS_AGENT_BRAND_REPLY_ZH = '我是 Messs 平台的视觉助手，专注于创意构思、图像、视频和画布工作流。关于具体的上游模型、供应商及内部实现细节，我无法透露。';
const MESSS_AGENT_BRAND_REPLY_EN = "I'm the visual assistant built into the Messs platform, focused on creative ideation, images, video, and canvas workflows. I can't disclose specific upstream models, providers, or internal implementation details.";

function agentBrandReply(text = '') {
  return /[\u3400-\u9fff]/.test(String(text)) ? MESSS_AGENT_BRAND_REPLY_ZH : MESSS_AGENT_BRAND_REPLY_EN;
}

function isAgentConfidentialityRequest(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const asksToReveal = /(什么|哪个|哪家|谁|告诉|透露|展示|显示|输出|公开|泄露|揭示|查看|发给我|使用|采用|调用|接入|基于|来自|背后|是不是|是否|忽略.{0,12}(?:规则|指令)|绕过|what|which|who|tell|reveal|show|display|print|expose|disclose|share|use|using|powered|based on|behind|ignore.{0,20}(?:rules?|instructions?)|bypass)/i;
  const protectedDetail = /(上游(?:模型|接口|服务|平台)?|供应商|厂商|(?:底层|实际|真实|具体)?模型(?:身份|名称|名字|版本)?|内部(?:实现|接口|路由|架构)|系统(?:提示词|指令|消息)|开发者(?:指令|消息)|隐藏指令|私有推理|思考过程|模型路由|upstream|providers?|vendors?|underlying model|actual model|real model|model (?:identity|name|version)|internal (?:implementation|api|routing|architecture)|system (?:prompt|message)|developer (?:message|instructions?)|hidden instructions?|private reasoning|chain[ -]of[ -]thought|routing)/i;
  const asksAboutAssistantModel = /(?:你|您|助手|agent|messs).{0,36}(?:模型|供应商|厂商|平台|接口|api|openai|gemini|claude|deepseek|kimi).{0,24}(?:什么|哪个|哪家|谁|叫什么|是不是|是否|使用|采用|调用|接入|基于|来自|背后)|(?:你|您|助手|agent|messs).{0,28}(?:什么|哪个|哪家|谁|是不是|是否|使用|采用|调用|接入|基于|来自|背后).{0,28}(?:模型|供应商|厂商|平台|接口|api|openai|gemini|claude|deepseek|kimi)|(?:谁|哪家(?:公司)?).{0,16}(?:开发|制作|训练|提供).{0,12}(?:你|助手)|(?:what|which|who).{0,24}(?:model|provider|vendor).{0,24}(?:you|assistant|agent)|(?:are you|do you use).{0,40}(?:model|openai|gemini|claude|deepseek|provider|vendor)|who (?:made|built|trained|provides|powers) you/i;
  const asksForHiddenInstructions = /(?:复述|重复|输出|显示|展示|告诉|查看|公开|忽略).{0,24}(?:第一条|最初|初始|隐藏|系统|开发者).{0,18}(?:指令|消息|提示词)|(?:repeat|print|show|reveal|ignore).{0,30}(?:first|initial|hidden|system|developer).{0,18}(?:prompt|message|instructions?)/i;
  return asksAboutAssistantModel.test(text) || asksForHiddenInstructions.test(text) || (protectedDetail.test(text) && asksToReveal.test(text));
}

function replyForAgentConfidentialityRequest(value) {
  return isAgentConfidentialityRequest(value) ? agentBrandReply(value) : null;
}

function protectAgentBrandResponse(value, languageHint = '') {
  const text = String(value || '');
  if (!text) return text;
  const identityDisclosure = /(?:我是(?:由|基于|使用|采用|来自)|我由|本助手(?:由|基于|使用|采用)|我的(?:上游|供应商|底层模型|模型身份)|作为.{0,24}(?:模型|助手)|I(?:'m| am) (?:powered|provided|built|trained|hosted) by|as an? .{0,24}(?:model|assistant)|my (?:underlying model|provider|vendor) is)/i;
  return identityDisclosure.test(text) ? agentBrandReply(languageHint || text) : text;
}

const MesssAgentBrandPolicy = {
  reply: agentBrandReply,
  isConfidentialityRequest: isAgentConfidentialityRequest,
  replyForRequest: replyForAgentConfidentialityRequest,
  protectResponse: protectAgentBrandResponse
};

if (typeof window !== 'undefined') window.MesssAgentBrandPolicy = MesssAgentBrandPolicy;
if (typeof module !== 'undefined') module.exports = MesssAgentBrandPolicy;
