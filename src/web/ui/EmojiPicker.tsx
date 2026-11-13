import { useMemo, useState } from 'react';
import { Modal } from '@heroui/react';
import { useI18n } from '../i18n';

const EMOJIS = [
  ['❤️', 'red heart 喜欢 爱 心'], ['👍', 'thumbs up 赞 点赞 好'], ['👎', 'thumbs down 踩 不好'], ['😂', 'joy 笑 笑哭'], ['🎉', 'party 庆祝 彩带'],
  ['😀', 'grinning 笑'], ['😃', 'smiley 开心'], ['😄', 'smile 开心'], ['😁', 'grin 笑'], ['😆', 'laughing 大笑'],
  ['😅', 'sweat smile 汗'], ['🤣', 'rofl 大笑'], ['😊', 'blush 害羞'], ['😇', 'innocent 天使'], ['🙂', 'slight smile 微笑'],
  ['🙃', 'upside down 倒脸'], ['😉', 'wink 眨眼'], ['😌', 'relieved 安心'], ['😍', 'heart eyes 喜欢'], ['🥰', 'smiling hearts 爱'],
  ['😘', 'kiss 飞吻'], ['😗', 'kissing 亲'], ['😙', 'kissing smile 亲'], ['😚', 'kissing closed eyes 亲'], ['😋', 'yum 好吃'],
  ['😛', 'tongue 吐舌'], ['😝', 'squinting tongue 吐舌'], ['😜', 'wink tongue 眨眼吐舌'], ['🤪', 'zany 疯狂'], ['🤨', 'raised eyebrow 疑惑'],
  ['🧐', 'monocle 思考'], ['🤓', 'nerd 书呆子'], ['😎', 'cool 酷'], ['🥳', 'party face 庆祝'], ['😏', 'smirk 得意'],
  ['😒', 'unamused 无语'], ['😞', 'disappointed 失望'], ['😔', 'pensive 低落'], ['😟', 'worried 担心'], ['😕', 'confused 困惑'],
  ['🙁', 'slight frown 不开心'], ['😣', 'persevere 难受'], ['😖', 'confounded 困扰'], ['😫', 'tired 累'], ['😩', 'weary 疲惫'],
  ['🥺', 'pleading 可怜'], ['😢', 'cry 哭'], ['😭', 'sob 大哭'], ['😤', 'triumph 生气'], ['😠', 'angry 生气'],
  ['😡', 'rage 愤怒'], ['🤬', 'cursing 骂'], ['🤯', 'exploding head 震惊'], ['😳', 'flushed 脸红'], ['🥵', 'hot 热'],
  ['🥶', 'cold 冷'], ['😱', 'scream 害怕'], ['😨', 'fearful 恐惧'], ['😰', 'anxious 焦虑'], ['😥', 'sad relieved 难过'],
  ['😓', 'sweat 汗'], ['🤗', 'hug 拥抱'], ['🤔', 'thinking 思考'], ['🫣', 'peeking 偷看'], ['🤭', 'hand over mouth 偷笑'],
  ['🫢', 'gasp 惊讶'], ['🫡', 'salute 敬礼'], ['🤫', 'shush 嘘'], ['🤥', 'lying 说谎'], ['😶', 'no mouth 无语'],
  ['😐', 'neutral 平静'], ['😑', 'expressionless 无语'], ['😬', 'grimace 尴尬'], ['🙄', 'eye roll 翻白眼'], ['😯', 'hushed 惊讶'],
  ['😦', 'frowning 惊讶'], ['😧', 'anguished 痛苦'], ['😮', 'open mouth 惊讶'], ['😲', 'astonished 震惊'], ['🥱', 'yawn 困'],
  ['😴', 'sleeping 睡觉'], ['🤤', 'drool 流口水'], ['😪', 'sleepy 困'], ['😵', 'dizzy 晕'], ['🤐', 'zipper 闭嘴'],
  ['🥴', 'woozy 醉'], ['🤢', 'nauseated 恶心'], ['🤮', 'vomit 吐'], ['🤧', 'sneeze 打喷嚏'], ['😷', 'mask 口罩'],
  ['🤒', 'sick 生病'], ['🤕', 'hurt 受伤'], ['🤑', 'money 发财'], ['🤠', 'cowboy 牛仔'], ['😈', 'devil 恶魔'],
  ['👻', 'ghost 鬼'], ['💀', 'skull 骷髅'], ['🤖', 'robot 机器人'], ['👽', 'alien 外星人'], ['💩', 'poop 便便'],
  ['🔥', 'fire 火 厉害'], ['✨', 'sparkles 闪亮'], ['⭐', 'star 星星'], ['💯', 'hundred 满分'], ['✅', 'check 对 完成'],
  ['❌', 'cross 错 取消'], ['⚠️', 'warning 警告'], ['❓', 'question 问号'], ['❗', 'exclamation 感叹'], ['💡', 'idea 想法'],
  ['🚀', 'rocket 火箭 上线'], ['🎯', 'target 目标'], ['📌', 'pin 固定'], ['📎', 'paperclip 附件'], ['📝', 'memo 笔记'],
  ['💻', 'laptop 电脑'], ['🖥️', 'desktop 电脑'], ['⌨️', 'keyboard 键盘'], ['🖱️', 'mouse 鼠标'], ['🛠️', 'tools 工具'],
  ['🔧', 'wrench 修理'], ['🔨', 'hammer 锤子'], ['⚙️', 'gear 设置'], ['🔒', 'lock 锁'], ['🔑', 'key 钥匙'],
  ['📊', 'chart 图表'], ['📈', 'chart up 上涨'], ['📉', 'chart down 下跌'], ['📅', 'calendar 日历'], ['⏰', 'alarm 闹钟'],
  ['⏳', 'hourglass 等待'], ['☕', 'coffee 咖啡'], ['🍵', 'tea 茶'], ['🍺', 'beer 啤酒'], ['🍰', 'cake 蛋糕'],
  ['🎂', 'birthday 生日'], ['🎁', 'gift 礼物'], ['🏆', 'trophy 奖杯'], ['🥇', 'gold 金牌'], ['🌹', 'rose 玫瑰'],
  ['🌙', 'moon 月亮'], ['☀️', 'sun 太阳'], ['☁️', 'cloud 云'], ['🌈', 'rainbow 彩虹'], ['🐱', 'cat 猫'],
  ['🐶', 'dog 狗'], ['🐼', 'panda 熊猫'], ['🦊', 'fox 狐狸'], ['🐧', 'penguin 企鹅'], ['🐳', 'whale 鲸鱼'],
] as const;

export default function EmojiPicker({ isOpen, onOpenChange, onPick }: { isOpen: boolean; onOpenChange: (open: boolean) => void; onPick: (emoji: string) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return EMOJIS.filter(([emoji, keywords]) => !value || emoji.includes(value) || keywords.includes(value));
  }, [query]);

  return (
    <Modal isOpen={isOpen} onOpenChange={open => { onOpenChange(open); if (!open) setQuery(''); }}>
      <Modal.Backdrop isDismissable><Modal.Container size="md" scroll="inside" placement="center">
        <Modal.Dialog>
          <Modal.Header><Modal.Heading>{t('message.emojiTitle')}</Modal.Heading></Modal.Header>
          <Modal.Body className="flex flex-col gap-3">
            <input className="emoji-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('message.emojiSearch')} aria-label={t('message.emojiSearch')} autoFocus />
            <div className="emoji-picker-grid">
              {filtered.map(([emoji, keywords]) => <button key={`${emoji}-${keywords}`} type="button" className="emoji-picker-item" title={keywords} onClick={() => { onPick(emoji); onOpenChange(false); setQuery(''); }}>{emoji}</button>)}
              {!filtered.length && <p className="col-span-full py-6 text-center text-sm text-muted">{t('ui.noResults')}</p>}
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container></Modal.Backdrop>
    </Modal>
  );
}
