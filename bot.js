const token = '3ec3b314f796362aeb91c65e4bab6a0cb8239ae9c5fb935fb26e7437e8a93817541ecec224eb6e459f3c4';
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
        async function getNeededUser(user, conversationID) {
            // Получаем всех пользователей беседы
            const conversation = await bot.execute('messages.getConversationMembers', {
                peer_id: conversationID,
            });
            // Получаем нужного пользователя
            return conversation.profiles.filter((profile) => {
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
        //==========================================================================================
        // Активировать бота
        bot.command('!bot', (ctx) => {
            ctx.reply('Бот активирован &#128170;', null, Markup
                .keyboard([
                    [
                        Markup.button('Кинуть репорт &#128078;', 'negative'),
                        Markup.button('Кинуть респект &#129305;', 'positive'),
                    ],
                    [
                        Markup.button('Узнать статус пользователя &#128373;&#127998;&#8205;&#9794;&#65039;', 'default'),
                    ],
                    [
                        Markup.button('Анекдот &#128518;', 'default'),
                    ]
                ])
            )
        });
        //==========================================================================================
        bot.command(/(анек|анекдот|анекдоты)/i, (ctx) => {
            async function ajax() {
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
            ajax(ctx).then(data => {
                let str = data.replace(/\{"content":"/, '');
                str = str.split('"}')[0]
                ctx.reply(str)
            })
        })
        //==========================================================================================
        bot.command(/!(report|respect|res|rep)\s\[[\w]+\W@[\w-]+\]\s[a-zа-я0-9\W]+/i, async (ctx) => {
            antiSpam(ctx, 30);
            if (!ctx.session.access) return;
            // Пользователя которого ввели
            const dropUser = ctx.message.text.match(/@[\w-]+/ig)[0].slice(1);
            // report или respect
            let state = findState(ctx);
            if (state === 'res') state = 'respect';
            if (state === 'rep') state = 'report';
            // Причина репорта/респекта
            let reason = ctx.message.text.split(' ').filter((_, i) => i !== 0 && i !== 1).join(' ');
            // Получаем отправителя
            const sender = await bot.execute('users.get', {
                user_ids: ctx.message.from_id
            });

            // id беседы
            const roomID = ctx.message.peer_id;
            // Пользователь с беседы
            let neededUser = await getNeededUser(dropUser, roomID);

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
                    return ctx.reply(`@${neededUser.screen_name} получил ${state} ${sticker} (${mark}1)${flag ? `, причина: ${reason}` : ``}`)
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

                // Отправитель кидает себе? Надо наказать!
                if (sender[0].last_name === neededUser.last_name) {
                    if (state === 'report') return ctx.reply(`@${neededUser.screen_name}, ну ты и &#129313;`);
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
                                    merit: [reason],
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
                                    fail: [reason]
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
                        const arMerit = [...merit, reason];
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
                        const arFail = [...fail, reason];
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
        });
        bot.command(/!(report|respect|res|rep)\s\[[\w]+\W@[\w-]+\]/i, async (ctx) => {
            let state = findState(ctx);
            ctx.reply(`!${state} @id причина`);
        });
        bot.command(/!(report|respect|res|rep)/i, async (ctx) => {
            let state = findState(ctx);
            ctx.reply(`!${state} @id причина`);
        });
        // триггер на кнопки: Кинуть респект/репорт
        bot.command(/@respecto_bot\]\sкинуть\s(респект|репорт)/ig, async (ctx) => {
            let state = findState(ctx, true);
            ctx.reply(`!${state} @id причина`);
        });
        bot.command(/кинуть\s(респект|репорт)/ig, async (ctx) => {
            let state = findState(ctx, true);
            ctx.reply(`!${state} @id причина`);
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
                    `@${statusUser.user} - ${statusUser.status}\n(Респектов: ${statusUser.respect} | Репортов: ${statusUser.report})\nЗаслуги: ${merit}\nКосяки: ${fail}`
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
