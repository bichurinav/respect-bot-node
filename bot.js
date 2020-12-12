const token = '3ec3b314f796362aeb91c65e4bab6a0cb8239ae9c5fb935fb26e7437e8a93817541ecec224eb6e459f3c4';
const dbURL = 'mongodb+srv://bichurinet:Ab2507011097@respect-bot.o6dm1.mongodb.net/respect-bot?retryWrites=true&w=majority';
const VK = require('node-vk-bot-api');
const Markup = require('node-vk-bot-api/lib/markup');
const Session = require('node-vk-bot-api/lib/session');
const fs = require('fs');
const DB = 'users.json';
const bot = new VK(token);
const session = new Session();
const mongoose = require('mongoose');
const room = require('./schema/room');


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
                return new RegExp(user, 'i').test(profile.last_name);
            })[0];
        }
        function capitalizeUser(user) {
            return user[0].toUpperCase() + user.slice(1);
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
                    ]
                ])
            )
        });
        //==========================================================================================
        bot.command(/!(report|respect|res|rep)\s\[[\w]+\W@[\w-]+\]\s[a-zа-я0-9\W]+/i, async (ctx) => {
            // Пользователя которого ввели
            const dropUser = ctx.message.text.match(/@[\w-]+/ig)[0];
            // report или respect
            let state = findState(ctx);
            if (state === 'res') state = 'respect';
            if (state === 'rep') state = 'report';
            // Причина репорта/респекта
            let reason = ctx.message.text.split(' ').filter((_, i) => i !== 0 && i !== 1).join(' ');
            // Получаем отправителя
            const sender = await bot.execute('users.get', {
                user_ids: ctx.message.from_id
            })[0];
            // id беседы
            const roomID = ctx.message.peer_id;
            // Пользователь с беседы
            const neededUser = await getNeededUser(dropUser, roomID);

            return console.log('CLOSED');

            if (neededUser) {
                // Получаем ссылку на пользователя
                const linkUser = neededUser.screen_name;
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
                    return ctx.reply(`@${linkUser} получил ${state} ${sticker} (${mark}1)${flag ? `, причина: ${reason}` : ``}`)
                }
                // Меняем статус пользователя
                function changeStatus(respect, report) {
                    if (respect / report > 2) {
                        return 'Респектабельный'
                    }
                    if (respect / report >= 1) {
                        return 'Ровный'
                    }
                    if (report > respect) {
                        return 'Вафля'
                    }
                }

                const hasRoom = await room.find({room: roomID});
                if (!hasRoom[0]) await createRoomDB();

                // Отправитель кидает себе? Надо наказать!
                if (sender.last_name === neededUser.last_name) {
                    if (state === 'report') return ctx.reply('Ну ты и клоун &#129313;');
                    state = 'report';
                    reason = 'любопытный';
                    ctx.session.reportFlag = true;
                }

                const hasUser = await room.find({room: roomID, 'list.user': neededUser.last_name});
                if (!hasUser[0]) {
                    // Пользователя нету в этой беседе, добавляем его
                    if (state === 'respect') {
                        room.updateOne({room: roomID}, {
                            $push: {
                                list: {
                                    user: neededUser.last_name,
                                    status: 'Нормальный',
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
                                    user: neededUser.last_name,
                                    status: 'Вафля',
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
                    const findState = await room.findOne({room: roomID, 'list.user': neededUser.last_name});
                    let report = findState.list[0].report;
                    let respect = findState.list[0].respect;
                    if (state === 'respect') {
                        respect += 1;
                        const arMerit = [...findState.list[0].merit, reason];
                        room.updateOne({room: roomID, 'list.user': neededUser.last_name}, {
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
                        const arFail = [...findState.list[0].fail, reason];
                        room.updateOne({room: roomID, 'list.user': neededUser.last_name}, {
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
                ctx.reply(`Пользователя ${dropUser} не существует, обратитесь к своему психотерапевту &#129301;`);
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

            ctx.reply('ehooo')
            // const user = ctx.message.text.split(' ')[1];
            // const neededUser = await getNeededUser(user, ctx.message.peer_id);
            // if (neededUser) {
            //     const roomID = ctx.message.peer_id;
            //     const findUser = await room.findOne({room: roomID, 'list.user': neededUser.last_name});
            //
            //     const statusUser = findUser.list.filter(profile => {
            //         return profile.user === neededUser.last_name;
            //     })[0];
            //
            //     if (!statusUser) return ctx.reply(`&#128203; О пользователе ${capitalizeUser(user)} ничего не слышно...`);
            //
            //     const merit = statusUser.merit.join(', ');
            //     const fail = statusUser.fail.join(', ');
            //     ctx.reply(
            //         `${statusUser.user} - ${statusUser.status}\n(Респектов: ${statusUser.respect} | Репортов: ${statusUser.report})\nЗаслуги: ${merit}\nКосяки: ${fail}`
            //     )
            // } else {
            //     ctx.reply(`Пользователя ${user} не существует, обратитесь к своему психотерапевту &#129301;`);
            // }
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
