import '../../node_modules/emoji-picker-element/index.js';
import english from '../../node_modules/emoji-picker-element/i18n/en.js';
import simplifiedChinese from '../../node_modules/emoji-picker-element/i18n/zh_CN.js';

window.MesssEmojiPickerI18n = {
  en: english,
  zh: simplifiedChinese
};
window.dispatchEvent(new CustomEvent('messs:emoji-picker-ready'));
