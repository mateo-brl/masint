// Catalogue des plateformes : réseaux sociaux, messageries, fournisseurs d'email,
// opérateurs, blockchains, hébergeurs. `si` est le slug simple-icons quand le logo existe,
// sinon l'interface affiche un badge coloré avec les initiales.

import type { CategoryId } from './entityTypes'

export interface PlatformDef {
  id: string
  name: string
  category: CategoryId
  color: string
  si?: string
  /** Modèle d'URL de profil, `{u}` est remplacé par l'identifiant. */
  url?: string
  /** Domaines d'email rattachés (fournisseurs d'email). */
  domains?: string[]
  /** Explorateur pour les blockchains, `{a}` est remplacé par l'adresse. */
  explorer?: string
  /** Type d'entité créé quand on glisse cette plateforme sur le canevas. */
  entityType?: string
}

type Row = [id: string, name: string, si: string | null, color: string, url?: string]

const rows = (category: CategoryId, entityType: string, list: Row[]): PlatformDef[] =>
  list.map(([id, name, si, color, url]) => ({
    id,
    name,
    category,
    color,
    entityType,
    ...(si ? { si } : {}),
    ...(url ? { url } : {})
  }))

const SOCIAL: Row[] = [
  ['facebook', 'Facebook', 'facebook', '#0866FF', 'https://www.facebook.com/{u}'],
  ['instagram', 'Instagram', 'instagram', '#FF0069', 'https://www.instagram.com/{u}/'],
  ['x', 'X (Twitter)', 'x', '#FFFFFF', 'https://x.com/{u}'],
  ['tiktok', 'TikTok', 'tiktok', '#FF0050', 'https://www.tiktok.com/@{u}'],
  ['snapchat', 'Snapchat', 'snapchat', '#FFFC00', 'https://www.snapchat.com/add/{u}'],
  ['linkedin', 'LinkedIn', null, '#0A66C2', 'https://www.linkedin.com/in/{u}'],
  ['youtube', 'YouTube', 'youtube', '#FF0000', 'https://www.youtube.com/@{u}'],
  ['twitch', 'Twitch', 'twitch', '#9146FF', 'https://www.twitch.tv/{u}'],
  ['reddit', 'Reddit', 'reddit', '#FF4500', 'https://www.reddit.com/user/{u}'],
  ['pinterest', 'Pinterest', 'pinterest', '#BD081C', 'https://www.pinterest.com/{u}/'],
  ['tumblr', 'Tumblr', 'tumblr', '#36465D', 'https://{u}.tumblr.com'],
  ['threads', 'Threads', 'threads', '#FFFFFF', 'https://www.threads.com/@{u}'],
  ['bluesky', 'Bluesky', 'bluesky', '#0285FF', 'https://bsky.app/profile/{u}'],
  ['mastodon', 'Mastodon', 'mastodon', '#6364FF'],
  ['vk', 'VK', 'vk', '#0077FF', 'https://vk.com/{u}'],
  ['okru', 'Odnoklassniki', 'odnoklassniki', '#EE8208', 'https://ok.ru/{u}'],
  ['weibo', 'Weibo', 'sinaweibo', '#E6162D', 'https://weibo.com/{u}'],
  ['github', 'GitHub', 'github', '#FFFFFF', 'https://github.com/{u}'],
  ['gitlab', 'GitLab', 'gitlab', '#FC6D26', 'https://gitlab.com/{u}'],
  ['bitbucket', 'Bitbucket', 'bitbucket', '#0052CC', 'https://bitbucket.org/{u}/'],
  ['codeberg', 'Codeberg', 'codeberg', '#2185D0', 'https://codeberg.org/{u}'],
  ['gitee', 'Gitee', 'gitee', '#C71D23', 'https://gitee.com/{u}'],
  ['stackoverflow', 'Stack Overflow', 'stackoverflow', '#F58025'],
  ['hackernews', 'Hacker News', 'ycombinator', '#F0652F', 'https://news.ycombinator.com/user?id={u}'],
  ['devto', 'DEV', 'devdotto', '#FFFFFF', 'https://dev.to/{u}'],
  ['medium', 'Medium', 'medium', '#FFFFFF', 'https://medium.com/@{u}'],
  ['substack', 'Substack', 'substack', '#FF6719', 'https://{u}.substack.com'],
  ['quora', 'Quora', 'quora', '#B92B27', 'https://www.quora.com/profile/{u}'],
  ['producthunt', 'Product Hunt', 'producthunt', '#DA552F', 'https://www.producthunt.com/@{u}'],
  ['behance', 'Behance', 'behance', '#1769FF', 'https://www.behance.net/{u}'],
  ['dribbble', 'Dribbble', 'dribbble', '#EA4C89', 'https://dribbble.com/{u}'],
  ['deviantart', 'DeviantArt', 'deviantart', '#05CC47', 'https://www.deviantart.com/{u}'],
  ['flickr', 'Flickr', 'flickr', '#0063DC', 'https://www.flickr.com/people/{u}/'],
  ['vimeo', 'Vimeo', 'vimeo', '#1AB7EA', 'https://vimeo.com/{u}'],
  ['dailymotion', 'Dailymotion', 'dailymotion', '#0A0A0A', 'https://www.dailymotion.com/{u}'],
  ['kick', 'Kick', 'kick', '#53FC18', 'https://kick.com/{u}'],
  ['rumble', 'Rumble', 'rumble', '#85C742', 'https://rumble.com/user/{u}'],
  ['soundcloud', 'SoundCloud', 'soundcloud', '#FF5500', 'https://soundcloud.com/{u}'],
  ['spotify', 'Spotify', 'spotify', '#1ED760', 'https://open.spotify.com/user/{u}'],
  ['deezer', 'Deezer', null, '#A238FF'],
  ['applemusic', 'Apple Music', 'applemusic', '#FA243C'],
  ['gravatar', 'Gravatar', 'gravatar', '#1E8CBE', 'https://gravatar.com/{u}'],
  ['keybase', 'Keybase', 'keybase', '#33A0FF', 'https://keybase.io/{u}'],
  ['patreon', 'Patreon', 'patreon', '#FF424D', 'https://www.patreon.com/{u}'],
  ['onlyfans', 'OnlyFans', 'onlyfans', '#00AFF0', 'https://onlyfans.com/{u}'],
  ['kofi', 'Ko-fi', 'kofi', '#FF5E5B', 'https://ko-fi.com/{u}'],
  ['buymeacoffee', 'Buy Me a Coffee', 'buymeacoffee', '#FFDD00', 'https://www.buymeacoffee.com/{u}'],
  ['linktree', 'Linktree', 'linktree', '#43E55E', 'https://linktr.ee/{u}'],
  ['aboutme', 'About.me', 'aboutdotme', '#00A98F', 'https://about.me/{u}'],
  ['wordpress', 'WordPress', 'wordpress', '#21759B', 'https://{u}.wordpress.com'],
  ['blogger', 'Blogger', 'blogger', '#FF5722', 'https://{u}.blogspot.com'],
  ['strava', 'Strava', 'strava', '#FC4C02', 'https://www.strava.com/athletes/{u}'],
  ['garmin', 'Garmin Connect', 'garmin', '#007CC3'],
  ['komoot', 'Komoot', 'komoot', '#6AA127'],
  ['alltrails', 'AllTrails', 'alltrails', '#428813'],
  ['duolingo', 'Duolingo', 'duolingo', '#58CC02', 'https://www.duolingo.com/profile/{u}'],
  ['weward', 'WeWard', null, '#3D2BFF'],
  ['battlenet', 'Battle.net', 'battledotnet', '#148EFF'],
  ['steam', 'Steam', 'steam', '#FFFFFF', 'https://steamcommunity.com/id/{u}'],
  ['epicgames', 'Epic Games', 'epicgames', '#FFFFFF'],
  ['xbox', 'Xbox', null, '#107C10', 'https://www.xboxgamertag.com/search/{u}'],
  ['playstation', 'PlayStation', 'playstation', '#0070D1', 'https://psnprofiles.com/{u}'],
  ['nintendo', 'Nintendo', null, '#E60012'],
  ['roblox', 'Roblox', 'roblox', '#FFFFFF', 'https://www.roblox.com/user.aspx?username={u}'],
  ['minecraft', 'Minecraft', null, '#62B47A', 'https://namemc.com/profile/{u}'],
  ['riotgames', 'Riot Games', 'riotgames', '#EB0029'],
  ['chesscom', 'Chess.com', 'chessdotcom', '#81B64C', 'https://www.chess.com/member/{u}'],
  ['lichess', 'Lichess', 'lichess', '#FFFFFF', 'https://lichess.org/@/{u}'],
  ['osu', 'osu!', 'osu', '#FF66AA', 'https://osu.ppy.sh/users/{u}'],
  ['itchio', 'itch.io', 'itchdotio', '#FA5C5C', 'https://{u}.itch.io'],
  ['letterboxd', 'Letterboxd', 'letterboxd', '#202830', 'https://letterboxd.com/{u}/'],
  ['goodreads', 'Goodreads', 'goodreads', '#F4F1EA'],
  ['imdb', 'IMDb', 'imdb', '#F5C518'],
  ['tripadvisor', 'Tripadvisor', 'tripadvisor', '#34E0A1', 'https://www.tripadvisor.com/Profile/{u}'],
  ['airbnb', 'Airbnb', 'airbnb', '#FF5A5F'],
  ['uber', 'Uber', 'uber', '#FFFFFF'],
  ['vinted', 'Vinted', 'vinted', '#09B1BA'],
  ['leboncoin', 'Leboncoin', null, '#EC5A13'],
  ['ebay', 'eBay', 'ebay', '#E53238', 'https://www.ebay.com/usr/{u}'],
  ['etsy', 'Etsy', 'etsy', '#F16521', 'https://www.etsy.com/people/{u}'],
  ['amazon', 'Amazon', null, '#FF9900'],
  ['aliexpress', 'AliExpress', 'aliexpress', '#FF4747'],
  ['shopify', 'Shopify', 'shopify', '#7AB55C'],
  ['tinder', 'Tinder', 'tinder', '#FF6B6B'],
  ['bumble', 'Bumble', null, '#FFC629'],
  ['badoo', 'Badoo', 'badoo', '#783BF9'],
  ['meetup', 'Meetup', 'meetup', '#ED1C40', 'https://www.meetup.com/members/{u}/'],
  ['trello', 'Trello', 'trello', '#0052CC', 'https://trello.com/{u}'],
  ['notion', 'Notion', 'notion', '#FFFFFF'],
  ['slack', 'Slack', 'slack', '#4A154B'],
  ['paypal', 'PayPal', 'paypal', '#00457C', 'https://www.paypal.com/paypalme/{u}'],
  ['venmo', 'Venmo', 'venmo', '#3D95CE', 'https://account.venmo.com/u/{u}'],
  ['cashapp', 'Cash App', 'cashapp', '#00C244', 'https://cash.app/${u}'],
  ['google', 'Google', 'google', '#4285F4'],
  ['microsoft', 'Microsoft', null, '#00A4EF'],
  ['apple', 'Apple', 'apple', '#FFFFFF'],
  ['adobe', 'Adobe', null, '#FF0000'],
  ['wikipedia', 'Wikipedia', 'wikipedia', '#FFFFFF', 'https://en.wikipedia.org/wiki/User:{u}'],
  ['kaggle', 'Kaggle', 'kaggle', '#20BEFF', 'https://www.kaggle.com/{u}'],
  ['huggingface', 'Hugging Face', 'huggingface', '#FFD21E', 'https://huggingface.co/{u}'],
  ['npm', 'npm', 'npm', '#CB3837', 'https://www.npmjs.com/~{u}'],
  ['pypi', 'PyPI', 'pypi', '#3775A9', 'https://pypi.org/user/{u}/'],
  ['dockerhub', 'Docker Hub', 'docker', '#2496ED', 'https://hub.docker.com/u/{u}'],
  ['replit', 'Replit', 'replit', '#F26207', 'https://replit.com/@{u}'],
  ['codepen', 'CodePen', 'codepen', '#FFFFFF', 'https://codepen.io/{u}'],
  ['leetcode', 'LeetCode', 'leetcode', '#FFA116', 'https://leetcode.com/{u}/'],
  ['codewars', 'Codewars', 'codewars', '#B1361E', 'https://www.codewars.com/users/{u}'],
  ['hackerrank', 'HackerRank', 'hackerrank', '#00EA64', 'https://www.hackerrank.com/profile/{u}'],
  ['codeforces', 'Codeforces', 'codeforces', '#1F8ACB', 'https://codeforces.com/profile/{u}'],
  ['rubygems', 'RubyGems', 'rubygems', '#E9573F', 'https://rubygems.org/profiles/{u}'],
  ['pastebin', 'Pastebin', 'pastebin', '#02456C', 'https://pastebin.com/u/{u}'],
  ['openstreetmap', 'OpenStreetMap', 'openstreetmap', '#7EBC6F', 'https://www.openstreetmap.org/user/{u}'],
  ['myanimelist', 'MyAnimeList', 'myanimelist', '#2E51A2', 'https://myanimelist.net/profile/{u}'],
  ['anilist', 'AniList', 'anilist', '#02A9FF', 'https://anilist.co/user/{u}'],
  ['pixelfed', 'Pixelfed', 'pixelfed', '#6366F1'],
  ['hackthebox', 'Hack The Box', 'hackthebox', '#9FEF00'],
  ['tryhackme', 'TryHackMe', 'tryhackme', '#212C42', 'https://tryhackme.com/p/{u}'],
  ['hackerone', 'HackerOne', 'hackerone', '#494649', 'https://hackerone.com/{u}'],
  ['bugcrowd', 'Bugcrowd', 'bugcrowd', '#F26822', 'https://bugcrowd.com/{u}'],
  ['fiverr', 'Fiverr', 'fiverr', '#1DBF73', 'https://www.fiverr.com/{u}'],
  ['upwork', 'Upwork', 'upwork', '#6FDA44'],
  ['malt', 'Malt', 'malt', '#FC5757'],
  ['freelancer', 'Freelancer', 'freelancer', '#29B2FE', 'https://www.freelancer.com/u/{u}'],
  ['lastpass', 'LastPass', 'lastpass', '#D32D27'],
  ['eventbrite', 'Eventbrite', null, '#F05537'],
  ['indeed', 'Indeed', 'indeed', '#003A9B'],
  ['glassdoor', 'Glassdoor', 'glassdoor', '#00A162'],
  ['trustpilot', 'Trustpilot', 'trustpilot', '#00B67A'],
  ['crunchbase', 'Crunchbase', 'crunchbase', '#0288D1'],
  ['opensea', 'OpenSea', 'opensea', '#2081E2', 'https://opensea.io/{u}'],
  ['eyecon', 'Eyecon', null, '#2563EB'],
  ['callapp', 'CallApp', null, '#1E88E5'],
  ['truecaller', 'Truecaller', null, '#0087FF'],
  ['hudsonrock', 'Hudson Rock', null, '#F5B700'],
  ['imgur', 'Imgur', 'imgur', '#1BB76E', 'https://imgur.com/user/{u}'],
  ['flipboard', 'Flipboard', 'flipboard', '#E12828', 'https://flipboard.com/@{u}'],
  ['periscope', 'Periscope', null, '#40A4C4'],
  ['clubhouse', 'Clubhouse', 'clubhouse', '#FFE450', 'https://www.clubhouse.com/@{u}'],
  ['couchsurfing', 'Couchsurfing', null, '#ED6506'],
  ['last.fm', 'Last.fm', 'lastdotfm', '#D51007', 'https://www.last.fm/user/{u}'],
  ['mixcloud', 'Mixcloud', 'mixcloud', '#5000FF', 'https://www.mixcloud.com/{u}/'],
  ['bandcamp', 'Bandcamp', 'bandcamp', '#408294', 'https://{u}.bandcamp.com'],
  ['myspace', 'Myspace', null, '#030303', 'https://myspace.com/{u}'],
  ['picsart', 'Picsart', 'picsart', '#C209C1'],
  ['unsplash', 'Unsplash', 'unsplash', '#FFFFFF', 'https://unsplash.com/@{u}'],
  ['500px', '500px', '500px', '#0099E5', 'https://500px.com/p/{u}'],
  ['vsco', 'VSCO', 'vsco', '#FFFFFF', 'https://vsco.co/{u}'],
  ['wattpad', 'Wattpad', 'wattpad', '#FF500A', 'https://www.wattpad.com/user/{u}'],
  ['scribd', 'Scribd', 'scribd', '#1E7B85'],
  ['slideshare', 'SlideShare', 'slideshare', '#008ED2'],
  ['issuu', 'Issuu', 'issuu', '#F36D5D', 'https://issuu.com/{u}'],
  ['gumroad', 'Gumroad', 'gumroad', '#FF90E8', 'https://{u}.gumroad.com'],
  ['tipeee', 'Tipeee', null, '#E43F5A', 'https://fr.tipeee.com/{u}'],
  ['leetchi', 'Leetchi', null, '#00B8A9']
]

const MESSAGING: Row[] = [
  ['telegram', 'Telegram', 'telegram', '#26A5E4', 'https://t.me/{u}'],
  ['whatsapp', 'WhatsApp', 'whatsapp', '#25D366', 'https://wa.me/{u}'],
  ['signal', 'Signal', 'signal', '#3B45FD'],
  ['discord', 'Discord', 'discord', '#5865F2'],
  ['skype', 'Skype', null, '#00AFF0'],
  ['teams', 'Microsoft Teams', null, '#6264A7'],
  ['viber', 'Viber', 'viber', '#7360F2'],
  ['wechat', 'WeChat', 'wechat', '#07C160'],
  ['line', 'LINE', 'line', '#00C300'],
  ['threema', 'Threema', 'threema', '#3FE669'],
  ['kik', 'Kik', 'kik', '#82BC23'],
  ['session', 'Session', null, '#00F782'],
  ['matrix', 'Matrix / Element', 'element', '#0DBD8B'],
  ['wire', 'Wire', 'wire', '#FFFFFF'],
  ['messenger', 'Messenger', 'messenger', '#00B2FF'],
  ['teamspeak', 'TeamSpeak', 'teamspeak', '#4B69B6'],
  ['qq', 'QQ', 'qq', '#1EBAFC'],
  ['zalo', 'Zalo', 'zalo', '#0068FF'],
  ['kakaotalk', 'KakaoTalk', 'kakaotalk', '#FFCD00'],
  ['zoom', 'Zoom', 'zoom', '#0B5CFF']
]

const EMAIL_PROVIDERS: Array<[string, string, string | null, string, string[]]> = [
  ['gmail', 'Gmail', 'gmail', '#EA4335', ['gmail.com', 'googlemail.com']],
  ['outlook', 'Outlook / Hotmail', null, '#0078D4', ['outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com']],
  ['yahoo', 'Yahoo Mail', null, '#6001D2', ['yahoo.com', 'yahoo.fr', 'ymail.com', 'rocketmail.com']],
  ['proton', 'Proton Mail', 'protonmail', '#6D4AFF', ['proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me']],
  ['icloud', 'iCloud Mail', 'icloud', '#3693F3', ['icloud.com', 'me.com', 'mac.com']],
  ['gmx', 'GMX', 'gmx', '#1C449B', ['gmx.com', 'gmx.fr', 'gmx.de', 'gmx.net']],
  ['laposte', 'La Poste', null, '#FFD200', ['laposte.net']],
  ['orange_mail', 'Orange Mail', 'orange', '#FF7900', ['orange.fr', 'wanadoo.fr']],
  ['free_mail', 'Free', null, '#CD1E25', ['free.fr', 'aliceadsl.fr']],
  ['sfr_mail', 'SFR Mail', null, '#E2001A', ['sfr.fr', 'neuf.fr', 'cegetel.net', 'club-internet.fr']],
  ['bbox_mail', 'Bbox Mail', null, '#009DCC', ['bbox.fr']],
  ['yandex_mail', 'Yandex Mail', null, '#FC3F1D', ['yandex.com', 'yandex.ru', 'ya.ru']],
  ['mailru', 'Mail.ru', 'maildotru', '#005FF9', ['mail.ru', 'bk.ru', 'inbox.ru', 'list.ru']],
  ['tuta', 'Tuta', 'tuta', '#850122', ['tuta.io', 'tutanota.com', 'tutanota.de', 'tutamail.com']],
  ['zoho', 'Zoho Mail', 'zoho', '#E42527', ['zoho.com', 'zohomail.com']],
  ['aol', 'AOL Mail', null, '#31459B', ['aol.com', 'aol.fr']],
  ['mailfence', 'Mailfence', null, '#2C3E50', ['mailfence.com']],
  ['posteo', 'Posteo', null, '#8DAA36', ['posteo.de', 'posteo.net']],
  ['web_de', 'WEB.DE', null, '#FFD800', ['web.de']],
  ['disroot', 'Disroot', null, '#50162D', ['disroot.org']]
]

const CARRIERS: Row[] = [
  ['orange', 'Orange', 'orange', '#FF7900'],
  ['sfr', 'SFR', null, '#E2001A'],
  ['bouygues', 'Bouygues Telecom', null, '#009DCC'],
  ['free_mobile', 'Free Mobile', null, '#CD1E25'],
  ['sosh', 'Sosh', null, '#FF7900'],
  ['red_sfr', 'RED by SFR', null, '#E2001A'],
  ['bandyou', 'B&You', null, '#009DCC'],
  ['laposte_mobile', 'La Poste Mobile', null, '#FFD200'],
  ['nrj_mobile', 'NRJ Mobile', null, '#E30613'],
  ['lebara', 'Lebara', null, '#00A1E0'],
  ['lycamobile', 'Lycamobile', null, '#1B75BB'],
  ['prixtel', 'Prixtel', null, '#E6007E'],
  ['coriolis', 'Coriolis Telecom', null, '#00A3E0'],
  ['syma', 'Syma Mobile', null, '#E30613'],
  ['cdiscount_mobile', 'Cdiscount Mobile', null, '#0062AC'],
  ['auchan_telecom', 'Auchan Telecom', null, '#E30613'],
  ['transatel', 'Transatel', null, '#0099D8'],
  ['afone', 'Afone', null, '#4E2A84'],
  ['onoff', 'Onoff', null, '#00C8B4'],
  ['digicel', 'Digicel', null, '#E30613'],
  ['sfr_caraibe', 'SFR Caraïbe', null, '#E2001A'],
  ['only', 'Only', null, '#E6007E'],
  ['zeop', 'Zeop', null, '#00A0DF'],
  ['vodafone', 'Vodafone', 'vodafone', '#E60000'],
  ['deutsche_telekom', 'Deutsche Telekom', 'deutschetelekom', '#E20074'],
  ['tmobile', 'T-Mobile', null, '#E20074'],
  ['o2', 'O2', 'o2', '#0019A5'],
  ['telefonica', 'Telefónica', 'telefonica', '#0066FF'],
  ['movistar', 'Movistar', 'movistar', '#019DF4'],
  ['tim', 'TIM', null, '#004691'],
  ['windtre', 'WINDTRE', null, '#FF6A00'],
  ['iliad', 'Iliad', null, '#CD1E25'],
  ['proximus', 'Proximus', null, '#5C2D91'],
  ['base', 'BASE', null, '#00A6DE'],
  ['telenet', 'Telenet', null, '#FFC20E'],
  ['swisscom', 'Swisscom', null, '#001155'],
  ['salt', 'Salt', null, '#00C389'],
  ['sunrise', 'Sunrise', null, '#E2001A'],
  ['post_luxembourg', 'POST Luxembourg', null, '#FFCC00'],
  ['kpn', 'KPN', null, '#00C300'],
  ['telenor', 'Telenor', null, '#00ACE6'],
  ['telia', 'Telia', null, '#990AE3'],
  ['tele2', 'Tele2', null, '#000000'],
  ['ee', 'EE', null, '#007B85'],
  ['three', 'Three', null, '#000000'],
  ['bt', 'BT', null, '#5514B4'],
  ['virgin_media', 'Virgin Media', null, '#ED1A3B'],
  ['verizon', 'Verizon', 'verizon', '#CD040B'],
  ['att', 'AT&T', null, '#00A8E0'],
  ['rogers', 'Rogers', null, '#DA291C'],
  ['bell', 'Bell', null, '#00549A'],
  ['telus', 'Telus', null, '#4B286D'],
  ['vivo', 'Vivo', null, '#660099'],
  ['claro', 'Claro', null, '#DA291C'],
  ['telcel', 'Telcel', null, '#0B2B7E'],
  ['mtn', 'MTN', null, '#FFCB05'],
  ['airtel', 'Airtel', null, '#ED1C24'],
  ['jio', 'Jio', null, '#0F3CC9'],
  ['etisalat', 'e& (Etisalat)', null, '#E00800'],
  ['ooredoo', 'Ooredoo', null, '#ED1C24'],
  ['stc', 'stc', null, '#4F008C'],
  ['turkcell', 'Turkcell', null, '#FFC900'],
  ['maroc_telecom', 'Maroc Telecom', null, '#0072BC'],
  ['inwi', 'inwi', null, '#8B2E8B'],
  ['djezzy', 'Djezzy', null, '#E30613'],
  ['mobilis', 'Mobilis', null, '#00A651'],
  ['tunisie_telecom', 'Tunisie Telecom', null, '#0072BC'],
  ['docomo', 'NTT Docomo', null, '#CC0033'],
  ['softbank', 'SoftBank', null, '#B4B4B4'],
  ['china_mobile', 'China Mobile', null, '#0085D0'],
  ['sk_telecom', 'SK Telecom', null, '#EA002C'],
  ['telstra', 'Telstra', null, '#0099F8'],
  ['optus', 'Optus', null, '#00807F'],
  ['megafon', 'MegaFon', null, '#00B956'],
  ['mts', 'MTS', null, '#E30611'],
  ['beeline', 'Beeline', null, '#FFC800'],
  ['kyivstar', 'Kyivstar', null, '#00A3E0'],
  ['play', 'Play', null, '#5B2D90'],
  ['plus', 'Plus', null, '#00A651']
]

const CHAINS: Array<[string, string, string | null, string, string]> = [
  ['bitcoin', 'Bitcoin', 'bitcoin', '#F7931A', 'https://mempool.space/address/{a}'],
  ['ethereum', 'Ethereum', 'ethereum', '#627EEA', 'https://etherscan.io/address/{a}'],
  ['tether', 'Tether (USDT)', 'tether', '#26A17B', 'https://tronscan.org/#/address/{a}'],
  ['tron', 'TRON', null, '#FF060A', 'https://tronscan.org/#/address/{a}'],
  ['solana', 'Solana', 'solana', '#9945FF', 'https://solscan.io/account/{a}'],
  ['litecoin', 'Litecoin', 'litecoin', '#345D9D', 'https://blockchair.com/litecoin/address/{a}'],
  ['monero', 'Monero', 'monero', '#FF6600', 'https://xmrchain.net/search?value={a}'],
  ['bnb', 'BNB Chain', 'bnbchain', '#F0B90B', 'https://bscscan.com/address/{a}'],
  ['xrp', 'XRP', 'xrp', '#FFFFFF', 'https://xrpscan.com/account/{a}'],
  ['dogecoin', 'Dogecoin', 'dogecoin', '#C2A633', 'https://blockchair.com/dogecoin/address/{a}'],
  ['cardano', 'Cardano', 'cardano', '#0033AD', 'https://cardanoscan.io/address/{a}'],
  ['polygon', 'Polygon', 'polygon', '#7B3FE4', 'https://polygonscan.com/address/{a}'],
  ['bitcoincash', 'Bitcoin Cash', 'bitcoincash', '#0AC18E', 'https://blockchair.com/bitcoin-cash/address/{a}'],
  ['dash', 'Dash', 'dash', '#008CE7', 'https://blockchair.com/dash/address/{a}'],
  ['zcash', 'Zcash', 'zcash', '#F4B728', 'https://blockchair.com/zcash/address/{a}'],
  ['avalanche', 'Avalanche', null, '#E84142', 'https://snowtrace.io/address/{a}'],
  ['polkadot', 'Polkadot', 'polkadot', '#E6007A', 'https://polkadot.subscan.io/account/{a}'],
  ['ton', 'Toncoin', 'ton', '#0098EA', 'https://tonviewer.com/{a}'],
  ['arbitrum', 'Arbitrum', null, '#28A0F0', 'https://arbiscan.io/address/{a}'],
  ['base_chain', 'Base', null, '#0052FF', 'https://basescan.org/address/{a}'],
  ['optimism', 'Optimism', 'optimism', '#FF0420', 'https://optimistic.etherscan.io/address/{a}'],
  ['coinbase', 'Coinbase', 'coinbase', '#0052FF', ''],
  ['binance', 'Binance', 'binance', '#F0B90B', ''],
  ['kraken', 'Kraken', null, '#5741D9', '']
]

const HOSTING: Row[] = [
  ['ovh', 'OVHcloud', 'ovh', '#123F6D'],
  ['aws', 'Amazon Web Services', null, '#FF9900'],
  ['cloudflare', 'Cloudflare', 'cloudflare', '#F38020'],
  ['gcp', 'Google Cloud', 'googlecloud', '#4285F4'],
  ['azure', 'Microsoft Azure', null, '#0078D4'],
  ['digitalocean', 'DigitalOcean', 'digitalocean', '#0080FF'],
  ['hetzner', 'Hetzner', 'hetzner', '#D50C2D'],
  ['scaleway', 'Scaleway', 'scaleway', '#4F0599'],
  ['gandi', 'Gandi', 'gandi', '#6640FE'],
  ['ionos', 'IONOS', 'ionos', '#003D8F'],
  ['godaddy', 'GoDaddy', 'godaddy', '#1BDBDB'],
  ['namecheap', 'Namecheap', 'namecheap', '#DE3723'],
  ['vercel', 'Vercel', 'vercel', '#FFFFFF'],
  ['netlify', 'Netlify', 'netlify', '#00C7B7'],
  ['githubpages', 'GitHub Pages', 'github', '#FFFFFF'],
  ['heroku', 'Heroku', 'heroku', '#430098'],
  ['akamai', 'Akamai / Linode', 'akamai', '#0096D6'],
  ['fastly', 'Fastly', 'fastly', '#FF282D'],
  ['oracle_cloud', 'Oracle Cloud', null, '#F80000'],
  ['alibabacloud', 'Alibaba Cloud', 'alibabacloud', '#FF6A00'],
  ['hostinger', 'Hostinger', 'hostinger', '#673DE6'],
  ['squarespace', 'Squarespace', 'squarespace', '#FFFFFF'],
  ['wix', 'Wix', 'wix', '#FFFFFF'],
  ['shopify_hosting', 'Shopify', 'shopify', '#7AB55C'],
  ['wordpress_com', 'WordPress.com', 'wordpress', '#21759B'],
  ['o2switch', 'o2switch', null, '#F39200'],
  ['infomaniak', 'Infomaniak', null, '#0098FF'],
  ['lws', 'LWS', null, '#E30613'],
  ['contabo', 'Contabo', null, '#1F2C5C'],
  ['vultr', 'Vultr', 'vultr', '#007BFC'],
  ['ovh_kimsufi', 'Kimsufi', null, '#123F6D'],
  ['online_net', 'Online.net', null, '#E30613'],
  ['leaseweb', 'Leaseweb', null, '#E5007D'],
  ['m247', 'M247', null, '#E30613'],
  ['choopa', 'Choopa', null, '#007BFC'],
  ['github_hosting', 'GitHub', 'github', '#FFFFFF'],
  ['render', 'Render', 'render', '#FFFFFF'],
  ['ns1', 'NS1 (IBM)', null, '#5C4EE5'],
  ['ultradns', 'UltraDNS (Vercara)', null, '#0072CE'],
  ['bunny', 'Bunny.net', 'bunnydotnet', '#FF7854'],
  ['oracle_dyn', 'Dyn (Oracle)', null, '#F80000']
]

const HLR: Row[] = [
  ['hlr_active', 'Actif / Active', null, '#22C55E'],
  ['hlr_inactive', 'Inactif / Inactive', null, '#EF4444']
]

export const PLATFORMS: PlatformDef[] = [
  ...rows('social', 'account', SOCIAL),
  ...rows('messaging', 'account', MESSAGING),
  ...EMAIL_PROVIDERS.map(([id, name, si, color, domains]) => ({
    id,
    name,
    category: 'email' as const,
    color,
    domains,
    entityType: 'email',
    ...(si ? { si } : {})
  })),
  ...rows('carrier', 'carrier', CARRIERS),
  ...CHAINS.map(([id, name, si, color, explorer]) => ({
    id,
    name,
    category: 'crypto' as const,
    color,
    entityType: 'crypto_wallet',
    ...(explorer ? { explorer } : {}),
    ...(si ? { si } : {})
  })),
  ...rows('hosting', 'hosting', HOSTING),
  ...rows('hlr', 'hlr', HLR)
]

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]))

export function getPlatform(id: string | null | undefined): PlatformDef | undefined {
  return id ? BY_ID.get(id) : undefined
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')

const BY_NAME = new Map<string, PlatformDef>()
for (const p of PLATFORMS) {
  BY_NAME.set(norm(p.id), p)
  if (!BY_NAME.has(norm(p.name))) BY_NAME.set(norm(p.name), p)
}

/** Retrouve une plateforme à partir d'un nom libre (« Free Mobile », « bouygues »...). */
export function findPlatformByName(name: string, category?: CategoryId): PlatformDef | undefined {
  const n = norm(name)
  if (!n) return undefined
  const direct = BY_NAME.get(n)
  if (direct && (!category || direct.category === category)) return direct
  const candidates = category ? PLATFORMS.filter((p) => p.category === category) : PLATFORMS
  return candidates.find((p) => {
    const pn = norm(p.name)
    return pn.length >= 3 && (n.startsWith(pn) || pn.startsWith(n))
  })
}

/** Fournisseur d'email déduit du domaine. */
export function emailProvider(email: string): PlatformDef | undefined {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return undefined
  return PLATFORMS.find((p) => p.domains?.includes(domain))
}

export function profileUrl(platformId: string, username: string): string | undefined {
  const p = getPlatform(platformId)
  return p?.url ? p.url.replace('{u}', encodeURIComponent(username)) : undefined
}
