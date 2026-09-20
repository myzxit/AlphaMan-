// AlphaMan 코어 파사드: 웹 서버와 데스크톱 앱이 동일하게 사용하는 진입점
import path from 'node:path';
import fs from 'node:fs';
import { Store, vercelBlobRemote } from './store.js';
import { AuthService, ADMIN_ACCOUNT } from './auth.js';
import { CreditService, PLANS, ADDON_PLANS } from './credits.js';
import { AIService } from './ai.js';
import { TranslateService } from './translate.js';
import { ShortsEngine } from './shorts/engine.js';
import { LongformEngine } from './longform.js';
import { PublishService, PLATFORMS } from './publish.js';
import { TopicService } from './topic.js';
import { ToolsService } from './tools.js';
import { NotificationService, SupportService } from './support.js';
import { SubtitleProjects } from './subtitles/projects.js';
import { DiscoveryService } from './discovery.js';
import { PixieService } from './pixie.js';
import { AdminService } from './admin.js';
import { VoiceService } from './voice.js';
import { RemixEngine, REMIX_LIMITS, REMIX_DEFAULTS } from './remix.js';
import { toolAvailability } from './media.js';
import { LOCALES } from './i18n.js';
import { CONTENT } from './content.js';

export const VERSION = '1.0.0';

export class AlphaMan {
  constructor({ dataDir, memory = false, platform = 'web' } = {}) {
    this.platform = platform; // 'web' | 'desktop'
    this.dataDir = dataDir || path.join(process.cwd(), 'data');
    this.uploadsDir = path.join(this.dataDir, 'uploads');
    this.outputDir = path.join(this.dataDir, 'output');
    if (!memory) for (const d of [this.dataDir, this.uploadsDir, this.outputDir]) fs.mkdirSync(d, { recursive: true });
    const remote = !memory && process.env.ALPHAMAN_STORE_MODE !== 'local' ? vercelBlobRemote() : null;
    this.store = memory ? Store.memory() : new Store(path.join(this.dataDir, 'alphaman.json'), { remote });
    this.ready = this.store.ready.then(() => { this.auth.seedAdmin(); });

    this.credits = new CreditService(this.store);
    this.auth = new AuthService(this.store, this.credits);
    this.notifications = new NotificationService(this.store);
    this.ai = new AIService();
    this.translate = new TranslateService(this.ai);
    this.support = new SupportService({ store: this.store, notifications: this.notifications });
    this.voice = new VoiceService({ store: this.store, outputDir: this.outputDir });
    this.shorts = new ShortsEngine({ store: this.store, credits: this.credits, ai: this.ai, translate: this.translate, notifications: this.notifications, uploadsDir: this.uploadsDir, outputDir: this.outputDir, voice: this.voice });
    this.longform = new LongformEngine({ store: this.store, credits: this.credits, ai: this.ai, notifications: this.notifications });
    this.publish = new PublishService({ store: this.store, notifications: this.notifications });
    this.topic = new TopicService({ store: this.store, ai: this.ai });
    this.tools = new ToolsService({ ai: this.ai });
    this.subtitles = new SubtitleProjects({ store: this.store, credits: this.credits, ai: this.ai, translate: this.translate, notifications: this.notifications });
    this.discovery = new DiscoveryService({ store: this.store });
    this.pixie = new PixieService({ store: this.store, ai: this.ai, support: this.support });
    this.remix = new RemixEngine({ store: this.store, credits: this.credits, ai: this.ai, translate: this.translate, voice: this.voice, notifications: this.notifications, outputDir: this.outputDir });
    this.admin = new AdminService({ store: this.store, credits: this.credits, auth: this.auth, support: this.support, notifications: this.notifications, publish: this.publish });

    this.auth.seedAdmin();
    this.publish.start();
  }

  async info() {
    return {
      name: 'AlphaMan', version: VERSION, platform: this.platform, locales: LOCALES,
      plans: PLANS, addonPlans: ADDON_PLANS, platforms: PLATFORMS,
      tools: toolAvailability(), ai: await this.ai.status(), voiceProviders: this.voice.providers(), remixLimits: REMIX_LIMITS,
      adminEmail: ADMIN_ACCOUNT.email,
      uploadMaxBytes: process.env.ALPHAMAN_UPLOAD_MAX_BYTES ? Number(process.env.ALPHAMAN_UPLOAD_MAX_BYTES) : (process.env.VERCEL ? 4.5 * 1024 * 1024 : 2 * 1024 * 1024 * 1024),
      serverless: Boolean(process.env.VERCEL),
      settings: this.admin.settings(),
      content: CONTENT,
    };
  }

  registerUpload(userId, { filename, mimeType, size, path: filePath }) {
    return this.store.insert('uploads', { userId, filename, mimeType, size, path: filePath });
  }

  close() {
    this.publish.stop();
    this.store.flush();
  }
}

export { ADMIN_ACCOUNT, PLANS, ADDON_PLANS, PLATFORMS, LOCALES, CONTENT };
export { ADMIN_USER_ID, verifySessionToken } from './auth.js';
export { ApiError } from './errors.js';
export { validateVideoMeta, parseYoutubeUrl, parseVideoUrl } from './media.js';
export { TEMPLATES, GENRES, RATIOS } from './shorts/templates.js';
export { FONTS, SUBTITLE_STYLE_PRESETS } from './subtitles/fonts.js';
export { exportSubtitles, parseSRT, toSRT, toVTT, toASS } from './subtitles/format.js';
export { semanticSplit } from './subtitles/stt.js';
export { nextOccurrences } from './publish.js';
export { TOOLS } from './tools.js';
export { REMIX_LIMITS, REMIX_DEFAULTS } from './remix.js';
export { VOICE_STYLES } from './voice.js';
