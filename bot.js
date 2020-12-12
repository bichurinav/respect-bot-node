const token = '3ec3b314f796362aeb91c65e4bab6a0cb8239ae9c5fb935fb26e7437e8a93817541ecec224eb6e459f3c4';
const VK = require('node-vk-bot-api');
const Markup = require('node-vk-bot-api/lib/markup');
const Session = require('node-vk-bot-api/lib/session');
const fs = require('fs');
const DB = 'users.json';
const bot = new VK(token);
const session = new Session();
// const PORT = process.env.PORT || 80;

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
function getState(ctx, offset = 1) {
    const state = ctx.message.text.split(' ')[offset];
    if (state === 'респект') {
        ctx.reply('!respect Фамилия Причина');
    } else if (state === 'репорт') {
        ctx.reply('!report Фамилия Причина');
    }
}

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
// КНОПКА: Узнать статус пользователя
bot.command(/узнать статус пользователя/i, async (ctx) => {
    ctx.reply('!status Фамилия')
});

// ТРИГГЕР НА ПОДСКАЗКУ: Кинуть респект/репорт
bot.command(/@respecto_bot\] Кинуть (респект|репорт)/ig, async (ctx) => {
    console.log(ctx);
    getState(ctx, 2)
});
bot.command(/кинуть (респект|репорт)/ig, async (ctx) => {
    getState(ctx)
});

// Кинуть кому-то респект/репорт
bot.command(/!(report|respect) [a-zа-я]{1,20} [а-яa-z0-9\s]+/i, async (ctx) => {

    const splitMessage = ctx.message.text.split(' ');
    let state = splitMessage[0].slice(1);

    if (state === 'respect') {
        state = 'респект'
    } else if (state === 'report') {
        state = 'репорт'
    }

    // Пользователь
    const user = splitMessage[1];

    // Причина
    let reason = splitMessage.filter((_, i) => i !== 0 && i !== 1).join(' ');
    // Получаем нужного пользователя
    const sender = await bot.execute('users.get', {
        user_ids: ctx.message.from_id
    });

    const neededUser = await getNeededUser(user, ctx.message.peer_id);

    if (neededUser) {
        const linkUser = neededUser.screen_name;
        // Занесение в базу
        const users = JSON.parse(fs.readFileSync(DB, 'utf-8'));
        const statusUser = users.filter((user) => {
            return neededUser.last_name === user.user;
        })[0];

        function changeStatus(profile) {
            let respect = profile.respect;
            let report = profile.report;
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
        function changeStats() {
            users.forEach((profile) => {
                if (profile.user === statusUser.user) {
                    switch (state) {
                        case 'респект':
                            profile.respect += 1;
                            profile.merit.push(reason);
                            profile.status = changeStatus(profile);
                            writeInDB('+', '&#129305;');
                            break;
                        case 'репорт':
                            profile.report += 1;
                            profile.fail.push(reason);
                            profile.status = changeStatus(profile);
                            console.log(state);
                            writeInDB('-', '&#128078;');
                            break;
                    }
                }
            })
        }
        function writeInDB(mark, sticker) {
            const flag = ctx.session.reportFlag;
            ctx.reply(`@${linkUser} получил ${state} ${sticker} (${mark}1)${flag ? `, причина: ${reason}` : ``}`)
                .then(() => {
                    fs.writeFileSync(DB, JSON.stringify(users, null, 2));
                });
        }
        function createDataUser() {
            const schemeUser = {
                'user': neededUser.last_name,
                'respect': 0,
                'report': 0,
                'status': '',
                'fail': [],
                'merit': []
            };
            if (state === 'респект') {
                schemeUser.merit.push(reason);
                schemeUser.respect = schemeUser.respect + 1;
                schemeUser.status = 'Нормальный';
                users.push(schemeUser);
                writeInDB('+', '&#129305;')
            } else if (state === 'репорт') {
                schemeUser.fail.push(reason);
                schemeUser.report = schemeUser.report + 1;
                schemeUser.status = 'Вафля';
                users.push(schemeUser);
                writeInDB('-', '&#128078;')
            }
        }

        ctx.session.reportFlag = false;
        if (sender[0].last_name === neededUser.last_name) {
            if (state === 'репорт') return ctx.reply('Ну ты и клоун &#129313;');
            state = 'репорт';
            reason = 'любопытный';
            ctx.session.reportFlag = true;
        }

        if (!statusUser) {
            createDataUser()
        } else {
            changeStats()
        }


    } else {
        ctx.reply(`Пользователя ${user} не существует, обратитесь к своему психотерапевту &#129301;`);
    }
    ctx.session.userState = '';
});
bot.command(/!(report|respect) [a-zа-я]{1,20}/i, async (ctx) => {
    const splitMessage = ctx.message.text.split(' ');
    const state = splitMessage[0].slice(1);
    ctx.reply(`!${state} Фамилия Причина`);
});
// Посмореть статистику пользователя
bot.command(/!status [a-zа-я]{1,20}/i, async (ctx) => {
    const user = ctx.message.text.split(' ')[1];
    const neededUser = await getNeededUser(user, ctx.message.peer_id);
    if (neededUser) {
        const users = JSON.parse(fs.readFileSync(DB, 'utf-8'));
        const statusUser = users.filter((user) => {
            return neededUser.last_name === user.user;
        })[0];

        if (!statusUser) return ctx.reply(`&#128203; О пользователе ${capitalizeUser(user)} ничего не слышно...`);

        const merit = statusUser.merit.join(', ');
        const fail = statusUser.fail.join(', ');

        ctx.reply(
            `${statusUser.user} - ${statusUser.status}\n(Респектов: ${statusUser.respect} | Репортов: ${statusUser.report})\nЗаслуги: ${merit}\nКосяки: ${fail}`
        )
    } else {
        ctx.reply(`Пользователя ${user} не существует, обратитесь к своему психотерапевту &#129301;`);
    }
});

bot.startPolling();

