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
const schedule = require('node-schedule');

async function start() {
    try {
        // Подключение к базе данных
        const db = await mongoose.connect(dbURL, {useNewUrlParser: true, useUnifiedTopology: true});
        bot.use(session.middleware());
        // Получаем нужного пользователя
        async function getNeededUser(ctx, user, conversationID, userID) {
            // Получаем всех пользователей беседы
            try {
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
            antiSpam(ctx, 5);
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
                        // fags: [],
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
        //==========================================================================================
        // Выдать список команды
        bot.command(/^!(top|топ)\sfags$/, (ctx) => {
            ctx.reply('Потом на них посмотришь, создателю пока в падлу делать')
        })
        //==========================================================================================
        // Выдать список команды
        bot.command(/^!(help|хелп)$/, (ctx) => {
            ctx.reply('---- &#9997; Мои команды ----\n\n&#128237; [по пересланному сообщению]\n!res - кинуть респект своему хоуми\n' +
                '!rep - зарепортить\n!rep или !res <можно указать причину>\n\n&#127942; [топы]\n' +
                '!top res - топ челов по респектам\n!top rep - топ челов по репортам\n!top fags - топ faggots\n\n' +
                '&#128511; [по id]\n!rep или !res @id <можно указать причину>\n!st @id - узнать статус чела\n\n' +
                '&#128225; [по любому упоминанию]\nанек - рандомный анек\nгачи - рандомный гачист\n\n' +
                '&#128526; [для администраторв]\n!btn - добавляет меню\n!btn del - удаляет меню\n\n' +
                '&#128197; [автоматически]\nвыбирает раз в 6 часов faggot беседы')
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
                            Markup.button('Анекдот &#128518;', 'default'),
                            Markup.button('Gachi &#127814;', 'default'),
                        ]
                    ])
                )
            }
            checkAdmin(ctx, addButtons.bind(null, ctx))
        });
        //==========================================================================================
        // Поиск faggot беседы
        async function searchFag(dateFormat, kind) {
            async function sendMessage() {
                try {
                    const arRooms = await room.find({})
                    if (arRooms.length > 1) {
                        arRooms.forEach((el) => {
                            bot.execute('messages.getConversationMembers', {
                                peer_id: el.room,
                            }).then(conversation => {
                                if (conversation.profiles.length < 2) return; // Если в беседе один человек
                                const randomPerson = conversation.profiles[getRandomInt(0, conversation.profiles.length)];
                                bot.sendMessage(el.room, '&#128270; Поиск пидораса активирован')
                                    .then(() => {
                                        setTimeout(() => {
                                            bot.sendMessage(el.room, '🎰 Бип-буп-бип...')
                                                .catch((err) => {
                                                    console.error(err)
                                                })
                                        }, 1500)
                                        setTimeout(() => {
                                            bot.sendMessage(el.room, `📸 Faggot ${kind} найден — @${randomPerson.screen_name}(${randomPerson.last_name})`)
                                                .catch((err) => {
                                                    console.error(err)
                                                })
                                        }, 4000)
                                    })
                                    .catch((err) => {
                                        console.error(err)
                                    })
                            }).catch(err => console.error(err))
                        });
                    }
                } catch (err) {
                    console.error(err)
                }
            }
            switch (dateFormat) {
                case 'hour':
                    schedule.scheduleJob('0 */6 * * *', async () => {
                        sendMessage();
                    });
                    break;
                case 'test':
                    schedule.scheduleJob({hour: 22, minute: 30}, async () => {
                        sendMessage();
                    });
                    break;
            }
        }
        searchFag('hour', '');
        //searchFag('test', '');
        //==========================================================================================
        // Рандомный gachimuchi
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
                const randomGachi = arGachi[getRandomInt(0, arGachi.length)];
                ctx.reply(`@${randomPerson.screen_name}(${randomPerson.last_name}) ${randomGachi}`);
            } catch (e) {
                ctx.reply('&#9762; Для работы бота нужна админка!');
            }
        });
        //==========================================================================================
        // Рандомный анекдот
        bot.command(/(анек|анекдот|анекдоты)/i, (ctx) => {
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
                    console.error(err)
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
            antiSpam(ctx, 5);
            if (!ctx.session.access) return;
            // Пользователя которого ввели
            const dropUser = ctx.message.text.match(/@[\w-]+/ig)[0].slice(1);
            // Причина репорта/респекта
            let reason = ctx.message.text.split(' ').filter((_, i) => i !== 0 && i !== 1).join(' ');
            sayStateForUser(ctx, reason, dropUser);
        });
        bot.command(/!(report|respect|res|rep)\s\[[\w]+\W@[\w-]+\]/i, async (ctx) => {
            antiSpam(ctx, 5);
            if (!ctx.session.access) return;
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
        bot.startPolling();
    } catch (err) {
        console.error(err);
    }
}

start();
