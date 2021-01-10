const VK = require('node-vk-bot-api');
const api = require('node-vk-bot-api/lib/api');
const Markup = require('node-vk-bot-api/lib/markup');
const Session = require('node-vk-bot-api/lib/session');
const session = new Session();
const mongoose = require('mongoose');
const room = require('./schema/room');
const iconv = require('iconv-lite');
const axios = require('axios');
const config = require('config');
const fs = require('fs');

const token = config.get('token');
const dbURL = config.get('database');
const bot = new VK(token);
bot.use(session.middleware());

const cards21 = [
    {card: '6', score: 6}, {card: '7', score: 7}, {card: '8', score: 8},
    {card: '9', score: 9}, {card: '10', score: 10}, {card: 'J', score: 2},
    {card: 'Q', score: 3}, {card: 'K', score: 4}, {card: 'A', score: 11}
]

async function start() {
    try {
        // Подключение к базе данных
        await mongoose.connect(dbURL, {useNewUrlParser: true, useUnifiedTopology: true});
        // Получаем нужного пользователя
        async function getNeededUser(ctx, user, conversationID, userID) {
            try {
                // Получаем всех пользователей беседы
                const conversation = await bot.execute('messages.getConversationMembers', {
                    peer_id: conversationID,
                });
                // Получаем нужного пользователя
                return conversation.profiles.filter((profile) => {
                    if (userID) return new RegExp(userID, 'i').test(profile.id);
                    return new RegExp(user, 'i').test(profile.screen_name);
                })[0];
            } catch (e) {
                ctx.reply('&#9762; Для работы бота нужна админка!');
            }
        }
        // Получаем нужную комнату
        async function neededRoom(conversationID) {
            try {
                const arRooms = await room.find({})
                return arRooms.filter(el => el.room === conversationID)[0]
            } catch (err) {
                console.error(err)
                ctx.reply('&#9762; Произошла ошибка, не могу получить комнаты');
            }
        }
        // Ищем совпадение команды на респект/репорт
        function findState(ctx, ru = false) {
            if (ru) {
                let stateRU = ctx.message.text.match(/(респект|репорт)/ig)[0];
                if (stateRU === 'респект') return 'respect';
                if (stateRU === 'репорт') return 'report';
            }
            return ctx.message.text.match(/(report|respect|res|rep)/ig)[0]
        }
        // Ищем совпадение команды на статус
        function findStatus(ctx) {
            return ctx.message.text.match(/(status|st)/ig)[0]
        }
        // Получает мин. сек. мс.
        function getTime(unix) {
            const date = new Date(unix * 1000);
            return {
                m: date.getMinutes(),
                s: date.getSeconds(),
                ms: new Date().getMilliseconds()
            }
        }
        // Рандомное число
        function getRandomInt(min, max) {
            min = Math.ceil(min);
            max = Math.floor(max);
            return Math.floor(Math.random() * (max - min)) + min;
        }
        // Против спама
        function antiSpam(ctx, delay = 10) {
            ctx.session.userTime = ctx.session.userTime || getTime(ctx.message.date);
            ctx.session.warn = ctx.session.warn || 'warn';
            function check(res) {
                if (res < delay) {
                    ctx.session.access = false;
                    if (ctx.session.warn === 'warn') {
                        ctx.reply(`&#8987; Подождите еще ${delay - (getTime(ctx.message.date).s - ctx.session.userTime.s)} сек.`).then(() => {
                            ctx.session.warn = 'no-warn';
                        })
                    }
                } else {
                    ctx.session.warn = 'warn';
                    ctx.session.userTime = getTime(ctx.message.date);
                    ctx.session.access = true;
                }
            }
            if (ctx.session.userTime.m === getTime(ctx.message.date).m) {
                if (ctx.session.userTime.ms !== getTime(ctx.message.date).ms) {
                    check(getTime(ctx.message.date).s - ctx.session.userTime.s)
                } else {
                    ctx.session.userTime = getTime(ctx.message.date);
                    ctx.session.access = true;
                }
            } else {
                ctx.session.userTime = getTime(ctx.message.date);
                let res = 60 - ctx.session.userTime.s + getTime(ctx.message.date).s;
                check(res);
            }
        }
        // Кидает репорт/респект
        async function sayStateForUser(ctx, reason, dropUser, dropUserID = null) {
            antiSpam(ctx, 5);
            if (!ctx.session.access) return;
            let state = findState(ctx);
            // id беседы
            const roomID = ctx.message.peer_id;
            // Получаем отправителя
            const sender = await bot.execute('users.get', {
                user_ids: ctx.message.from_id
            });
            // Нужный пользователь с беседы
            let neededUser = null;

            if (dropUserID !== undefined && dropUser === null) {
                if (dropUserID) {
                    if (dropUserID.from_id < 0) return ctx.reply(`Cебе кинь &#128545;`);
                    neededUser = await getNeededUser(ctx,null, roomID, dropUserID.from_id);
                } else {
                    return ctx.reply(`&#9762; Перешлите сообщение, или \n !${state} @id <можно указать причину>`);
                }
            } else if (dropUserID === null) {
                neededUser = await getNeededUser(ctx, dropUser, roomID, null);
            } else {
                return ctx.reply(`!${state} @id причина`);
            }
            if (state === 'res') state = 'respect';
            if (state === 'rep') state = 'report';

            if (neededUser) {
                ctx.session.reportFlag = false;
                // Создаем беседу
                function createRoomDB() {
                    return room.create({
                        room: roomID,
                        list: []
                    })
                }
                // Отправляем результат пользователю
                function sendMessage(state, sticker, mark) {
                    const flag = ctx.session.reportFlag;
                    return ctx.reply(`@${neededUser.screen_name}(${neededUser.last_name}) получил ${state} ${sticker} (${mark}1)${flag ? `, причина: ${reason}` : ``}`)
                }
                // Меняем статус пользователя
                function changeStatus(respect, report) {
                    if (respect / report > 2) {
                        if (neededUser.sex === 1) return 'Респектабельная';
                        return 'Респектабельный'
                    }
                    if (respect / report >= 1) {
                        if (neededUser.sex === 1) return 'Ровная';
                        return 'Ровный'
                    }
                    if (report > respect) {
                        if (neededUser.sex === 1) return 'Вафелька';
                        return 'Вафля'
                    }
                }

                const hasRoom = await room.find({room: roomID});
                if (!hasRoom[0]) await createRoomDB();

                //Отправитель кидает себе? Надо наказать!
                if (sender[0].last_name === neededUser.last_name) {
                    if (state === 'report')
                        return ctx.reply(`@${neededUser.screen_name}(${neededUser.last_name}), ну ты и &#129313;`);
                    state = 'report';
                    reason = 'любопытный';
                    ctx.session.reportFlag = true;
                }

                const hasUser = await room.find({room: roomID, 'list.user': neededUser.screen_name});
                if (!hasUser[0]) {
                    // Пользователя нету в базе, добавляем его
                    if (state === 'respect') {
                        room.updateOne({room: roomID}, {
                            $push: {
                                list: {
                                    user: neededUser.screen_name,
                                    firstName: neededUser.first_name,
                                    lastName: neededUser.last_name,
                                    status: neededUser.sex === 1 ? 'Ровная' : 'Ровный',
                                    respect: 1,
                                    report: 0,
                                    merit: [reason ? reason : ''],
                                    fail: []
                                }
                            }
                        }).then(() => {
                            sendMessage('респект', '&#129305;', '+')
                        })
                    } else if (state === 'report') {
                        room.updateOne({room: roomID}, {
                            $push: {
                                list: {
                                    user: neededUser.screen_name,
                                    firstName: neededUser.first_name,
                                    lastName: neededUser.last_name,
                                    status: neededUser.sex === 1 ? 'Вафелька' : 'Вафля',
                                    respect: 0,
                                    report: 1,
                                    merit: [],
                                    fail: [reason ? reason : '']
                                }
                            }
                        }).then(() => {
                            sendMessage('репорт', '&#128078;', '-')
                        })
                    }
                } else {
                    // Пользователь есть в базе
                    const findState = await room.findOne({room: roomID, 'list.user': neededUser.screen_name});
                    let report = findState.list.filter((profile) => profile.user === neededUser.screen_name)[0].report;
                    let respect = findState.list.filter((profile) => profile.user === neededUser.screen_name)[0].respect;
                    let merit = findState.list.filter((profile) => profile.user === neededUser.screen_name)[0].merit;
                    let fail = findState.list.filter((profile) => profile.user === neededUser.screen_name)[0].fail;
                    if (state === 'respect') {
                        respect += 1;
                        let arMerit = [...merit];
                        if (reason) {
                            arMerit = [...merit, reason];
                        }
                        room.updateOne({room: roomID, 'list.user': neededUser.screen_name}, {
                            $set: {
                                'list.$.respect': respect,
                                'list.$.status': changeStatus(respect, report),
                                'list.$.merit': arMerit
                            }
                        }).then(() => {
                            sendMessage('респект', '&#129305;', '+')
                        })
                    } else if (state === 'report') {
                        report += 1;
                        let arFail = [...fail];
                        if (reason) {
                            arFail = [...fail, reason]
                        }
                        room.updateOne({room: roomID, 'list.user': neededUser.screen_name}, {
                            $set: {
                                'list.$.report': report,
                                'list.$.status': changeStatus(respect, report),
                                'list.$.fail': arFail
                            }
                        }).then(() => {
                            sendMessage('репорт', '&#128078;', '-')
                        })
                    }
                }

            } else {
                ctx.reply(`Пользователя @${dropUser} не существует, обратитесь к своему психотерапевту &#129301;`);
            }
        }
        //==========================================================================================
        // Выполнить функцию под админом
        async function checkAdmin(ctx, callback) {
            try {
                const res = await bot.execute('messages.getConversationMembers', {
                    peer_id: ctx.message.peer_id,
                })
                const admins = res.items.filter(item => item.is_admin)
                    .filter(admin => admin.member_id === ctx.message.from_id);
                if (admins.length > 0) {
                    callback();
                } else {
                    ctx.reply('&#9762; Доступ запрещен, вы не администратор!');
                }
            } catch (e) {
                ctx.reply('&#9762; Для работы бота нужна админка!');
            }
        }
        // Получить посты группы или кол-во записей
        async function getPosts(ownerID, count, offset, getLength) {
            const {response} = await api('wall.get',{
                owner_id: ownerID, count, offset, access_token: config.get('access_token')
            })
            if (getLength) return response.count
            return response.items;
        }
        // Получить посты по фильтру (video, photo, text)
        async function getFilterPosts(groupID, countPosts, offsetPosts, postType = 'photo') {
            const posts = await getPosts(groupID, countPosts, offsetPosts)
            const filterPosts = posts.filter(el => {
                if (Array.isArray(el.attachments)) {
                    const type = el.attachments[0].type;
                    return type === postType;
                } else {
                    return postType === 'text';
                }
            });
            if (filterPosts.length < 1) {
                return getFilterPosts(groupID, countPosts, offsetPosts, postType)
            }
            return filterPosts;
        }
        // Получить случайный, нужный пост
        async function giveRandomPost(ctx, groups, type) {
            antiSpam(ctx, 4);
            if (!ctx.session.access) return;
            ctx.session.group = '';
            try {
                // Выводит пост
                function sendPost(conversationID) {
                    if (type === 'video') {
                        bot.sendMessage(conversationID, '', `${type}${post.owner_id}_${post.id}`);
                    } else if (type === 'text') {
                        bot.sendMessage(conversationID, `${post.text}\n\n${source}`);
                    } else {
                        bot.sendMessage(conversationID, `${source}`, `${type}${post.owner_id}_${post.id}`);
                    }
                }
                // Получаем случайную группу
                ctx.session.group = groups[getRandomInt(0, groups.length)];
                // Источник
                const source = `[public${Math.abs(ctx.session.group)}|источник]`;
                // Кол-во записией в группе
                const count = await getPosts(ctx.session.group, 0, 0, true);
                // Получаем случаный сдвиг (с какой записи будем получать видео)
                const offset = getRandomInt(0, Math.floor(count - 98));
                // Получаем нужные посты
                const posts = await getFilterPosts(ctx.session.group, count, offset, type);
                // Получаем случайный пост
                const randomPost = posts[getRandomInt(0, posts.length)];
                // Пост
                let post = {};
                if (type !== 'text') {
                    post = randomPost.attachments[0][type];
                } else {
                    post = randomPost;
                }
                if (!post) return bot.sendMessage(ctx.message.peer_id, `&#9762; Блин блинский, давай еще раз(`);
                // Выводим пост
                sendPost(ctx.message.peer_id);
            } catch (err) {
                ctx.reply('&#9762; Блин, не могу выдать, сбой какой-то(')
                console.error(err);
            }
        }
        //==========================================================================================
        // ***********    BETA     *********
        bot.command(/^!21$/, (ctx) => {
            bot.sendMessage(ctx.message.peer_id, '🎯 Игра в 21 очко (beta version)', null, Markup
                .keyboard([
                    Markup.button({
                        action: {
                            type: 'text',
                            payload: JSON.stringify({
                                action: 'takeCards',
                            }),
                            label: "Взять карты"
                        }
                    }),
                    Markup.button({
                        action: {
                            type: 'text',
                            payload: JSON.stringify({
                                action: 'takeCard',
                            }),
                            label: "Взять еще"
                        }
                    }),
                    Markup.button({
                        action: {
                            type: 'text',
                            payload: JSON.stringify({
                                action: 'giveTop',
                            }),
                            label: "Топ челов"
                        }
                    }),
                    Markup.button({
                        action: {
                            type: 'text',
                            payload: JSON.stringify({
                                action: 'giveRule',
                            }),
                            label: "Правила"
                        }
                    }),
                    Markup.button({
                        action: {
                            type: 'text',
                            payload: JSON.stringify({
                                action: 'showCards',
                            }),
                            label: "Показать карты"
                        }
                    }),
                ], { columns: 2 })
                .inline()
            )
        })
        //==========================================================================================
        // Выдать список команд
        bot.command(/^!(help|хелп)$/, (ctx) => {
            ctx.reply('---- &#9997; Мои команды ----\n\n&#128237; [по пересланному сообщению]\n!res - кинуть респект своему хоуми\n' +
                '!rep - зарепортить\n!rep или !res <можно указать причину>\n\n&#127942; [топы]\n' +
                '!top res - топ челов по респектам\n!top rep - топ челов по репортам\n\n' +
                '&#128511; [по id]\n!rep или !res @id <можно указать причину>\n!st @id - узнать статус чела\n\n' +
                '&#127916; [видосики]\n!видос - случайный видос\n!видос ласт - последний видос\n\n' +
                '🐸 [мемы]\n!мем - случайный мем\n\n' +
                '&#128225; [по любому упоминанию]\nанек - случайный анекдот\nгачи - случайный гачист\n\n' +
                '&#128526; [для администраторв]\n!btn - добавляет меню\n!btn del - удаляет меню');
        })
        //==========================================================================================
        // Убрать у бота кнопки
        bot.command(/^!btn\sdel$/, async (ctx) => {
            function delButtons(ctx) {
                ctx.reply('Кнопки убраны &#127918;', null, Markup
                    .keyboard([])
                )
            }
            checkAdmin(ctx, delButtons.bind(null, ctx))
        });
        // Активировать у бота кнопки
        bot.command(/^!btn$/, (ctx) => {
            function addButtons(ctx) {
                ctx.reply('Кнопки активированы &#127918;', null, Markup
                    .keyboard([
                        [
                            Markup.button('Видос &#127916;', 'default'),
                            Markup.button('Анекдот &#128518;', 'default'),
                            Markup.button('Gachi &#127814;', 'default'),
                        ]
                    ])
                )
            }
            checkAdmin(ctx, addButtons.bind(null, ctx))
        });
        //==========================================================================================
        // Рандомное видео из группы VK
        const arVideoGroups = [-30316056, -167127847]; // Список групп (id)
        bot.command(/(^!(video|видос)$|\[[\w]+\W@[\w-]+\]\sвидос|видос\s🎬)/i, async (ctx) => {
            giveRandomPost(ctx, arVideoGroups, 'video');
        });
        // Последнее видео из группы VK
        bot.command(/^!(video|видос)\s(last|ласт)$/, async (ctx) => {
            try {
                const randomGroupVideo = arVideoGroups[getRandomInt(0, arVideoGroups.length)];
                const videoPosts = await getFilterPosts(randomGroupVideo, 20, 0, 'video');
                const video = videoPosts[0].attachments[0].video;
                bot.sendMessage(ctx.message.peer_id, '', `video${video.owner_id}_${video.id}`);
            } catch (err) {
                ctx.reply('&#9762; Блин, не могу выдать, сбой какой-то(')
                console.error(err);
            }
        })
        //==========================================================================================
        // Случайный мем из группы VK
        bot.command(/^!(mem|мем|memes|мемес)$/, async (ctx) => {
            const arMemGroups = [-45745333, -155464693]; // Список групп (id)
            giveRandomPost(ctx, arMemGroups, 'photo');
        })
        //==========================================================================================
        // Случайный анекдот для дедов
        bot.command(/^!(anec old|анек олд|анекдот олд)$/i, (ctx) => {
            antiSpam(ctx, 5);
            if (!ctx.session.access) return;
            async function getAnecdote() {
                try {
                    return axios.get(
                        'http://rzhunemogu.ru/RandJSON.aspx?CType=11',
                        {
                            responseType: 'arraybuffer',
                            responseEncoding: 'binary'
                        })
                        .then(response => iconv.decode(Buffer.from(response.data), 'windows-1251'))
                } catch (err) {
                    ctx.reply('&#9762; Блин, не могу выдать, сбой какой-то(')
                    console.error(err)
                }
            }
            getAnecdote(ctx).then(data => {
                let anecdote = data.replace(/\{"content":"/, '');
                anecdote = anecdote.split('"}')[0]
                ctx.reply(anecdote)
            })
        })
        //==========================================================================================
        // Случайный анекдот из группы VK
        bot.command(/(анек|анекдот|анекдоты)/i, async (ctx) => {
            const arAnecGroups = [-149279263]; // Список групп (id)
            giveRandomPost(ctx, arAnecGroups, 'text');
        })
        //==========================================================================================
        // Случайный gachimuchi
        bot.command(/(гачи|gachi)/i, async (ctx) => {
            antiSpam(ctx, 5);
            if (!ctx.session.access) return;
            const arGachi = ['&#9794;fuck you&#9794;', '&#9794;fucking slave&#9794;', '&#9794;boss on this gym&#9794;', '&#9794;dungeon master&#9794;', '&#9794;swallow my cum&#9794;', '&#9794;fat cock&#9794;', '&#9794;the semen&#9794;', '&#9794;full master&#9794;', '&#9794;drop of cum&#9794;', '&#9794;Billy&#9794;', '&#9794;do anal&#9794;', '&#9794;get your ass&#9794;', '&#9794;fisting anal&#9794;', '&#9794;long latex cock&#9794;', '&#9794;do finger in ass&#9794;', '&#9794;leatherman&#9794;', '&#9794;dick&#9794;', '&#9794;gay&#9794;', '&#9794;have nice ass&#9794;', '&#9794;boy next door&#9794;', '&#9794;Van&#9794;', '&#9794;leather stuff&#9794;', 'уклонился от gachimuchi'];
            try {
                const conversationID = ctx.message.peer_id;
                const conversation = await bot.execute('messages.getConversationMembers', {
                    peer_id: conversationID,
                });
                const randomPerson = conversation.profiles[getRandomInt(0, conversation.profiles.length)];
                const randomGachi = arGachi[getRandomInt(0, arGachi.length - 1)];
                ctx.reply(`@${randomPerson.screen_name}(${randomPerson.last_name}) ${randomGachi}`);
            } catch (e) {
                ctx.reply('&#9762; Для работы бота нужна админка!');
            }
        });
        //==========================================================================================
        bot.command(/!(report|respect|res|rep)\s\[[\w]+\W@[\w-]+\]\s[a-zа-я0-9\W]+/i, async (ctx) => {
            // Пользователя которого ввели
            const dropUser = ctx.message.text.match(/@[\w-]+/ig)[0].slice(1);
            // Причина репорта/респекта
            let reason = ctx.message.text.split(' ').filter((_, i) => i !== 0 && i !== 1).join(' ');
            sayStateForUser(ctx, reason, dropUser);
        });
        bot.command(/!(report|respect|res|rep)\s\[[\w]+\W@[\w-]+\]/i, async (ctx) => {
            // Пользователя которого ввели
            const dropUser = ctx.message.text.match(/@[\w-]+/ig)[0].slice(1);
            sayStateForUser(ctx, null, dropUser);
        });
        bot.command(/!(report|respect|res|rep)\s[a-zа-я0-9\W]+/i, async (ctx) => {
            let dropUserID = ctx.message.fwd_messages[0];
            // Причина репорта/респекта
            let reason = ctx.message.text.split(' ').filter((_, i) => i !== 0).join(' ');
            sayStateForUser(ctx, reason, null, dropUserID);
        });
        bot.command(/!(report|respect|res|rep)/i, async (ctx) => {
            let dropUserID = ctx.message.fwd_messages[0];
            sayStateForUser(ctx, null, null, dropUserID);
        });
        //==========================================================================================
        // Посмореть статистику пользователя
        bot.command(/^!(status|st)\s\[[\w]+\W@[\w-]+\]$/i, async (ctx) => {
            const user = ctx.message.text.match(/@[\w-]+/ig)[0].slice(1);
            const neededUser = await getNeededUser(ctx, user, ctx.message.peer_id);
            if (neededUser) {
                const roomID = ctx.message.peer_id;
                const findUser = await room.findOne({room: roomID, 'list.user': neededUser.screen_name});
                let statusUser = null;

                if (findUser) {
                    statusUser = findUser.list.filter(profile => {
                        return profile.user === neededUser.screen_name;
                    })[0];
                }

                if (!statusUser) return ctx.reply(`&#128203; О пользователе @${user} ничего не слышно...`);

                const merit = statusUser.merit.join(', ');
                const fail = statusUser.fail.join(', ');
                ctx.reply(
                    `@${statusUser.user}(${neededUser.last_name}) — ${statusUser.status}\n(Респектов: ${statusUser.respect} | Репортов: ${statusUser.report})\nЗаслуги: ${merit}\nКосяки: ${fail}`
                )
            } else {
                ctx.reply(`Пользователя @${user} не существует, обратитесь к своему психотерапевту &#129301;`);
            }
        });
        bot.command(/^!(status|st)$/i, async (ctx) => {
            let state = findStatus(ctx);
            ctx.reply(`!${state} @id`);
        });
        //==========================================================================================
        // Топ 10 участников по репортам/респектам
        bot.command(/^!(top|топ)\s(report|respect|res|rep)$/i, async (ctx) => {
            let state = findState(ctx);
            if (state === 'rep') state = 'report';
            if (state === 'res') state = 'respect';
            const conversationID = ctx.message.peer_id;
            try {
                const room = await neededRoom(conversationID)
                function compare(a, b) {
                    if (a[state] > b[state]) return -1;
                    if (a[state] === a[state]) return 0;
                    if (a[state] < a[state]) return 1;
                }
                const roomTop = room.list.sort(compare);
                const topList = roomTop.map((el, index) => {
                    if (index < 10) {
                        return `${index + 1}. ${el.firstName} ${el.lastName} - ${el[state]}\n`
                    }
                })
                ctx.reply(`Топ челов по ${state === 'respect' ? 'респектам &#129305;' : 'репортам &#128078;'}\n${topList.join('')}`);
            } catch (err) {
                ctx.reply('&#128203; Список пуст,' +
                    ' кидайте респекты/репорты участникам беседы')
            }
        });
        bot.command(/^!(top|топ)$/i, async (ctx) => {
            ctx.reply('&#9762; !top res или rep');
        });
        //==========================================================================================
        bot.event('message_new', async (ctx) => {
            if (ctx.message.payload) {
                function compare(a, b) {
                    if (a.score > b.score) return -1;
                    if (a.score === b.score) return 0;
                    if (a.score < b.score) return 1;
                }
                const payload = JSON.parse(ctx.message.payload)
                if (payload.action === 'takeCards') {
                    try {
                        const rooms = JSON.parse(fs.readFileSync('./cards21.json', 'utf-8'));
                        const neededRoom = rooms.filter(el => el.room === ctx.message.peer_id);
                        const cardOne = cards21[getRandomInt(0, cards21.length)];
                        const cardTwo = cards21[getRandomInt(0, cards21.length)];

                        if (neededRoom.length < 1) {
                            rooms.push({
                                room: ctx.message.peer_id,
                                start: false,
                                online: 1,
                                players: [{
                                    user: ctx.message.from_id,
                                    cards: [`[${cardOne.card}]`, `[${cardTwo.card}]`],
                                    score: cardOne.score + cardTwo.score,
                                }],
                                top: []
                            })
                            await bot.sendMessage(ctx.message.from_id, `-------\n[${cardOne.card}] [${cardTwo.card}]`)
                            fs.writeFileSync('./cards21.json', JSON.stringify(rooms, null, 2))
                        } else {
                            if (neededRoom[0].start) ctx.reply('🃏 Игроки играют, подождите...')
                            const players = neededRoom[0].players;
                            const existPlayer = players.filter(el => el.user === ctx.message.from_id)[0];
                            if (existPlayer) {
                                const user = await bot.execute('users.get', {
                                    user_ids: ctx.message.from_id,
                                    name_case: 'Nom'
                                })
                                return ctx.reply(`🃏 ${user[0].first_name}, ты уже взял карты!`,
                                    null, Markup
                                        .keyboard([
                                            Markup.button({
                                                action: {
                                                    type: 'text',
                                                    payload: JSON.stringify({
                                                        action: 'showCards',
                                                    }),
                                                    label: "Показать карты"
                                                }
                                            })
                                        ])
                                        .inline()
                                )
                            }

                            await bot.sendMessage(ctx.message.from_id, `-------\n[${cardOne.card}] [${cardTwo.card}]`)

                            if (cardOne.score + cardTwo.score === 22) {
                                return ctx.reply('🃏 Выпало 22', null,
                                    Markup
                                        .keyboard([
                                            Markup.button({
                                                action: {
                                                    type: 'text',
                                                    payload: JSON.stringify({
                                                        action: 'takeCards',
                                                    }),
                                                    label: "Взять карты"
                                                }
                                            })
                                        ])
                                        .inline()
                                )
                            }

                            neededRoom[0].players.push({
                                user: ctx.message.from_id,
                                cards: [`[${cardOne.card}]`, `[${cardTwo.card}]`],
                                score: cardOne.score + cardTwo.score
                            })
                            neededRoom[0].online += 1;
                            const arDelRoom = rooms.filter(el => el.room !== ctx.message.peer_id);
                            const newRooms = [neededRoom[0], ...arDelRoom];
                            fs.writeFileSync('./cards21.json', JSON.stringify(newRooms, null, 2))
                        }
                    } catch(err) {
                        console.log(err)
                        bot.sendMessage(ctx.message.peer_id, `🃏 Напиши боту в лс (что угодно), и тогда сможешь брать карты`,
                            null,  Markup
                                .keyboard([
                                    Markup.button({
                                        action: {
                                            type: 'open_link',
                                            link: 'https://vk.com/im?media=&sel=-201031864',
                                            label: "Написать"
                                        }
                                    })
                                ])
                                .inline()
                        )
                    }
                }
                if (payload.action === 'takeCard') {
                    try {
                        const rooms = JSON.parse(fs.readFileSync('./cards21.json', 'utf-8'));
                        const neededRoom = rooms.filter(el => el.room === ctx.message.peer_id);
                        const user = await bot.execute('users.get', {
                            user_ids: ctx.message.from_id,
                            fields: 'sex',
                            name_case: 'Nom'
                        })
                        const players = neededRoom[0].players;
                        const existPlayer = players.filter(el => el.user === ctx.message.from_id)[0];

                        if (!existPlayer) {
                            return ctx.reply(`🃏 ${user[0].first_name}, ты не ${user[0].sex === 2 ? 'взял' : 'взяла'} карты!`,
                                null, Markup
                                    .keyboard([
                                        Markup.button({
                                            action: {
                                                type: 'text',
                                                payload: JSON.stringify({
                                                    action: 'takeCards',
                                                }),
                                                label: "Взять карты"
                                            }
                                        })
                                    ])
                                    .inline()
                            )
                        }
                        if (players.length < 2) {
                            return ctx.reply(`🃏 Дождись хотя бы еще одного игрока, ему надо взять карты`)
                        }
                        if (existPlayer.score === 0) {
                            return ctx.reply(`🃏 ${user[0].first_name}, ты лох, не можешь брать`)
                        }

                        const card = cards21[getRandomInt(0, cards21.length)];
                        const scorePlayer = existPlayer.score + card.score;
                        const cardsPlayer = [...existPlayer.cards, `[${card.card}]`];
                        let updatePlayer = {
                            user: ctx.message.from_id,
                            cards: cardsPlayer,
                            score: scorePlayer
                        }
                        const arDelPlayer = players.filter(el => el.user !== ctx.message.from_id);
                        const arDelRoom = rooms.filter(el => el.room !== ctx.message.peer_id);

                        await bot.sendMessage(ctx.message.from_id, `[${card.card}]`)

                        let newRooms = null;
                        neededRoom[0].start = true;

                        if (scorePlayer > 21) {
                            updatePlayer = {
                                user: ctx.message.from_id,
                                cards: cardsPlayer,
                                score: 0
                            }
                            neededRoom[0].players = [updatePlayer, ...arDelPlayer];
                            neededRoom[0].online -= 1;

                            newRooms = [neededRoom[0], ...arDelRoom];
                            await bot.sendMessage(ctx.message.peer_id, `🃏 ${user[0].first_name} — лох, перебор ${scorePlayer}`);
                            fs.writeFileSync('./cards21.json', JSON.stringify(newRooms, null, 2));
                        } else {
                            neededRoom[0].players = [updatePlayer, ...arDelPlayer];
                            newRooms = [neededRoom[0], ...arDelRoom];
                            fs.writeFileSync('./cards21.json', JSON.stringify(newRooms, null, 2))
                        }
                    } catch (err) {
                        console.error(err)
                        ctx.reply('&#9762; Блин блинский, сбой какой-то, где-то создатель напортачил(')
                    }
                }
                if (payload.action === 'giveTop') {
                    const rooms = JSON.parse(fs.readFileSync('./cards21.json', 'utf-8'));
                    const neededRoom = rooms.filter(el => el.room === ctx.message.peer_id);
                    if (neededRoom.length < 1) {
                        return ctx.reply(`📜 Список пуст...`)
                    }
                    const topPlayers = neededRoom[0].top.sort(compare);
                    if (topPlayers.length < 1) {
                        return ctx.reply(`📜 Список пуст...`)
                    }
                    const topPlayerList = topPlayers.map((el, idx) => {
                        return `${idx + 1}. ${el.firstName} ${el.lastName} - ${el.score}\n`;
                    })
                    return ctx.reply(`📜 Топ челов в 21\n${topPlayerList.join('')}`);
                }
                if (payload.action === 'showCards') {
                    try {
                        const rooms = JSON.parse(fs.readFileSync('./cards21.json', 'utf-8'));
                        const neededRoom = rooms.filter(el => el.room === ctx.message.peer_id);
                        const players = neededRoom[0].players;
                        const existPlayer = players.filter(el => el.user === ctx.message.from_id)[0];

                        if (!existPlayer) {
                            const user = await bot.execute('users.get', {
                                user_ids: ctx.message.from_id,
                                fields: 'sex',
                                name_case: 'Nom'
                            })
                            return ctx.reply(`🃏 ${user[0].first_name}, ты не ${user[0].sex === 2 ? 'взял' : 'взяла'} карты!`,
                                null, Markup
                                    .keyboard([
                                        Markup.button({
                                            action: {
                                                type: 'text',
                                                payload: JSON.stringify({
                                                    action: 'takeCards',
                                                }),
                                                label: "Взять карты"
                                            }
                                        })
                                    ])
                                    .inline()
                            )
                        }
                        if (players.length < 2) {
                            return ctx.reply(`🃏 Дождись хотя бы еще одного игрока, ему надо взять карты`)
                        }
                        if (existPlayer.show) {
                            const user = await bot.execute('users.get', {
                                user_ids: ctx.message.from_id,
                                fields: 'sex',
                                name_case: 'Nom'
                            })
                            return ctx.reply(`🃏 ${user[0].first_name}, ты уже показывал свои карты!`)
                        }

                        const cards = existPlayer.cards.join(' ');
                        const arDelRoom = rooms.filter(el => el.room !== ctx.message.peer_id);
                        neededRoom[0].players.forEach((el) => {
                            if (el.user === ctx.message.from_id) {
                                el.show = true
                            }
                        })

                        if (existPlayer.score === 0) {
                            const user = await bot.execute('users.get', {
                                user_ids: ctx.message.from_id,
                                fields: 'sex',
                                name_case: 'Nom'
                            })
                            ctx.reply(`${user[0].first_name} ${user[0].sex === 2 ? 'проиграл' : 'проиграла'} с такими картами ${cards}`).then(() => {
                                fs.writeFileSync('./cards21.json', JSON.stringify([neededRoom[0], ...arDelRoom], null, 2))
                            })
                        } else {
                            neededRoom[0].start = true;
                            neededRoom[0].online -= 1;
                            const user = await bot.execute('users.get', {
                                user_ids: ctx.message.from_id,
                                fields: 'sex',
                                name_case: 'Gen'
                            })

                            await bot.sendMessage(ctx.message.peer_id, `🃏 у ${user[0].first_name} ${cards}, ${user[0].sex === 2 ? 'набрал' : 'набрала'} — ${existPlayer.score}`)
                            let newRooms = [neededRoom[0], ...arDelRoom];

                            if (neededRoom[0].online < 1) {
                                neededRoom[0].start = false;
                                neededRoom[0].online = 0;
                                const topPlayers = neededRoom[0].players.sort(compare)
                                neededRoom[0].players = [];
                                const user = await bot.execute('users.get', {
                                    user_ids: topPlayers[0].user,
                                    fields: 'sex',
                                    name_case: 'Nom'
                                })

                                const existTopPlayer = neededRoom[0].top.filter(el => el.user === topPlayers[0].user)[0];
                                if (!existTopPlayer) {
                                    neededRoom[0].top.push({
                                        user: topPlayers[0].user,
                                        firstName: user[0].first_name,
                                        lastName: user[0].last_name,
                                        score: 1
                                    });
                                } else {
                                    const arDelPlayer = neededRoom[0].top.filter(el => el.user !== topPlayers[0].user)
                                    const updatePlayer = {
                                        user: topPlayers[0].user,
                                        firstName: user[0].first_name,
                                        lastName: user[0].last_name,
                                        score: existTopPlayer.score + 1
                                    }
                                    neededRoom[0].top = [updatePlayer, ...arDelPlayer]
                                }
                                newRooms = [neededRoom[0], ...arDelRoom];
                                ctx.reply(`🥇 ${user[0].sex === 2 ? 'Выйграл' : 'Выйграла'} ${user[0].first_name} ${user[0].last_name}`).then(() => {
                                    fs.writeFileSync('./cards21.json', JSON.stringify(newRooms, null, 2))
                                })
                            } else {
                                fs.writeFileSync('./cards21.json', JSON.stringify(newRooms, null, 2))
                            }
                        }

                    } catch (err) {
                        console.error(err)
                        ctx.reply('&#9762; Блин блинский, сбой какой-то, где-то создатель напортачил(')
                    }
                }
                if (payload.action === 'giveRule') {
                    bot.sendMessage(ctx.message.peer_id, 'Нажимая на кнопку \n"Взять карты", бот выдаст в лс твои карты,' +
                        ' твоя задача набрать наибольшую сумму очков среди участников (максимально 21),' +
                        ' нажимая на кнопку "Взять еще", - бот выдаст одну карту в лс, если будет перебор,' +
                        ' ты автоматом будешь лохом. \nЕсли тебя устраивает сумма очков, нажми на кнопку' +
                        ' "Показать карты"\n\nA - 11 очков\nK - 4\nQ - 3\nJ - 2\n10 - 10\n9 - 9\n8 - 8\n7 - 7\n6 - 6')
                }
            }
        })
        //==========================================================================================
        bot.startPolling();
    } catch (err) {
        console.error(err);
    }
}
start();