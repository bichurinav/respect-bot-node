const token = '3ec3b314f796362aeb91c65e4bab6a0cb8239ae9c5fb935fb26e7437e8a93817541ecec224eb6e459f3c4';
//const token = '182f77a3b037809fa502f43e46a6ee81c008f3717cbd2d16e5a0585528bb7536260e831e27f43a99e0f69';
const dbURL = 'mongodb+srv://bichurinet:Ab2507011097@respect-bot.o6dm1.mongodb.net/respect-bot?retryWrites=true&w=majority';
const VK = require('node-vk-bot-api');
const Markup = require('node-vk-bot-api/lib/markup');
const Session = require('node-vk-bot-api/lib/session');
const bot = new VK(token);
const session = new Session();
const mongoose = require('mongoose');
const room = require('./schema/room');
const iconv = require('iconv-lite');
const axios = require('axios');

async function start() {
    try {
        // Подключение к базе данных
        const db = await mongoose.connect(dbURL, {useNewUrlParser: true, useUnifiedTopology: true});
        bot.use(session.middleware());
        async function getNeededUser(user, conversationID, userID) {
            // Получаем всех пользователей беседы
            const conversation = await bot.execute('messages.getConversationMembers', {
                peer_id: conversationID,
            });
            // Получаем нужного пользователя
            return conversation.profiles.filter((profile) => {
                if (userID) return new RegExp(userID, 'i').test(profile.id);
                return new RegExp(user, 'i').test(profile.screen_name);
            })[0];
        }
        function findState(ctx, ru = false) {
            if (ru) {
                let stateRU = ctx.message.text.match(/(респект|репорт)/ig)[0];
                if (stateRU === 'респект') return 'respect';
                if (stateRU === 'репорт') return 'report';
            }
            return ctx.message.text.match(/(report|respect|res|rep)/ig)[0]
        }
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
        function antiSpam(ctx, delay = 30) {
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
            antiSpam(ctx, 10);
            if (!ctx.session.access) return;
            let state = findState(ctx);
            // id беседы
            const roomID = ctx.message.peer_id;
            // Получаем отправителя
            const sender = await bot.execute('users.get', {
                user_ids: ctx.message.from_id
            });
            // Пользователь с беседы
            let neededUser = null;
            if (dropUserID !== undefined && dropUser === null) {
                if (dropUserID.from_id < 0) return ctx.reply(`Cебе кинь &#128545;`);
                neededUser = await getNeededUser(null, roomID, dropUserID.from_id);
            } else if (dropUserID === null) {
                neededUser = await getNeededUser(dropUser, roomID, null);
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
                    // Пользователя нету в этой беседе, добавляем его
                    if (state === 'respect') {
                        room.updateOne({room: roomID}, {
                            $push: {
                                list: {
                                    user: neededUser.screen_name,
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
                    // Пользователь есть уже в этой комнате
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
        // Активировать бота
        bot.command('!bot', (ctx) => {
            ctx.reply('Бот активирован &#128170;', null, Markup
                .keyboard([
                    [
                        Markup.button('Анекдот &#128518;', 'default'),
                        Markup.button('Gachi &#127814;', 'default'),
                    ]
                ])
            )
        });
        //==========================================================================================
        //Gachi
        bot.command(/(гачи|gachi)/i, async (ctx) => {
            antiSpam(ctx, 5);
            if (!ctx.session.access) return;
            const arGachi = ['&#9794;fuck you&#9794;', '&#9794cock&#9794', '&#9794;fucking slave&#9794;', '&#9794;boss on this gym&#9794;', '&#9794;dungeon master&#9794;', '&#9794;swallow my cum&#9794;', '&#9794;fat cock&#9794;', '&#9794;the semen&#9794;', '&#9794;full master&#9794;', '&#9794;drop of cum&#9794;', '&#9794;Billy&#9794;', '&#9794;do anal&#9794;', '&#9794;get your ass&#9794;', '&#9794;fisting anal&#9794;', '&#9794;long latex cock&#9794;', '&#9794;do finger in ass&#9794;', '&#9794;leatherman&#9794;', '&#9794;dick&#9794;', '&#9794;gay&#9794;', '&#9794;have nice ass&#9794;', '&#9794;boy next door&#9794;', '&#9794;Van&#9794;', '&#9794;leather stuff&#9794;', 'уклонился от gachimuchi'];
            const conversationID = ctx.message.peer_id;
            const conversation = await bot.execute('messages.getConversationMembers', {
                peer_id: conversationID,
            });
            if (!conversation) return ctx.reply('Я поломался #(');
            const randomPerson = conversation.profiles[getRandomInt(0, conversation.profiles.length)];
            const randomGachi = arGachi[getRandomInt(0, arGachi.length)];
            ctx.reply(`@${randomPerson.screen_name}(${randomPerson.last_name}) ${randomGachi}`);
        });
        //==========================================================================================
        bot.command(/(анек|анекдот|анекдоты)/, (ctx) => {
            antiSpam(ctx, 10);
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
                } catch (e) {
                    console.log(e)
                }
            }
            getAnecdote(ctx).then(data => {
                let str = data.replace(/\{"content":"/, '');
                str = str.split('"}')[0]
                ctx.reply(str)
            })
        })
        //==========================================================================================
        bot.command(/!(report|respect|res|rep)\s\[[\w]+\W@[\w-]+\]\s[a-zа-я0-9\W]+/i, async (ctx) => {
            antiSpam(ctx, 15);
            if (!ctx.session.access) return;
            // Пользователя которого ввели
            const dropUser = ctx.message.text.match(/@[\w-]+/ig)[0].slice(1);
            // Причина репорта/респекта
            let reason = ctx.message.text.split(' ').filter((_, i) => i !== 0 && i !== 1).join(' ');
            sayStateForUser(ctx, reason, dropUser);
        });
        bot.command(/!(report|respect|res|rep)\s\[[\w]+\W@[\w-]+\]/i, async (ctx) => {
            let state = findState(ctx);
            ctx.reply(`!${state} @id причина`);
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
            const neededUser = await getNeededUser(user, ctx.message.peer_id);
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
        bot.command(/!(status|st)/i, async (ctx) => {
            let state = findStatus(ctx);
            ctx.reply(`!${state} @id`);
        });
        // триггер на кнопку: Узнать статус пользователя
        bot.command(/узнать статус пользователя/i, async (ctx) => {
            ctx.reply('!status @id');
        });
        //==========================================================================================
        bot.startPolling();
    } catch (e) {
        console.log(e);
    }
}

start();
