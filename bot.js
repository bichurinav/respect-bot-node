//=-==-==-==-==-==-==-==-==-==-==-==-==-==-==-=
// БОТ СОЗДАВАЛСЯ ДЛЯ РАЗВЛЕЧЕНИЯ В БЕСЕДАХ VK
// author: Bichurin Artem bichurinet@ya.ru
//=-==-==-==-==-==-==-==-==-==-==-==-==-==-==-=
const VK = require("node-vk-bot-api");
const api = require("node-vk-bot-api/lib/api");
const Markup = require("node-vk-bot-api/lib/markup");
const Session = require("node-vk-bot-api/lib/session");
const session = new Session();
const mongoose = require("mongoose");
const room = require("./schema/room");
const iconv = require("iconv-lite");
const axios = require("axios");
const config = require("config");
const fs = require("fs");

const token = config.get("token");
const dbURL = config.get("database");
const bot = new VK(token);
bot.use(session.middleware());

const arCards21 = [
  { name: "6", score: 6 },
  { name: "7", score: 7 },
  { name: "8", score: 8 },
  { name: "9", score: 9 },
  { name: "10", score: 10 },
  { name: "J", score: 2 },
  { name: "Q", score: 3 },
  { name: "K", score: 4 },
  { name: "A", score: 11 },
];

const arItems = [
  { name: "glove", symbol: "🥊" },
  { name: "beer", symbol: "🍻" },
  { name: "weed", symbol: "🌿" },
];

const arLoot = [
  null,
  [
    arItems[1],
    arItems[0],
    arItems[1],
    arItems[0],
    arItems[2],
    arItems[0],
    arItems[1],
    arItems[0],
    arItems[1],
    arItems[2],
  ],
  null,
];

async function start() {
  try {
    // Подключение к базе данных
    await mongoose.connect(dbURL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    // Получаем нужного пользователя
    async function getNeededUser(ctx, user, conversationID, userID) {
      try {
        // Получаем всех пользователей беседы
        const conversation = await bot.execute(
          "messages.getConversationMembers",
          {
            peer_id: conversationID,
          }
        );
        // Получаем нужного пользователя
        return conversation.profiles.filter((profile) => {
          if (userID) return new RegExp(userID, "i").test(profile.id);
          return new RegExp(user, "i").test(profile.screen_name);
        })[0];
      } catch (err) {
        ctx.reply("☢ Для выполнения этой команды, боту нужна админка!");
      }
    }
    // Получаем нужную комнату
    async function neededRoom(conversationID) {
      try {
        const arRooms = await room.find({});
        return arRooms.filter((el) => el.room === conversationID)[0];
      } catch (err) {
        console.error(err);
      }
    }
    // Ищем совпадение команды на респект/репорт
    function findState(ctx, ru = false) {
      if (ru) {
        let stateRU = ctx.message.text.match(/(респект|репорт)/gi)[0];
        if (stateRU === "респект") return "respect";
        if (stateRU === "репорт") return "report";
      }
      return ctx.message.text.match(/(report|respect|res|rep)/gi)[0];
    }
    // Получить информацию о пользователе
    async function getUser(userID, nameCase = "nom") {
      try {
        const user = await bot.execute("users.get", {
          user_ids: userID,
          fields: "sex,screen_name",
          name_case: nameCase,
        });
        return user[0];
      } catch (err) {
        console.error(err);
      }
    }
    // Получает мин. сек. мс.
    function getTime(unix) {
      const date = new Date(unix * 1000);
      return {
        m: date.getMinutes(),
        s: date.getSeconds(),
        ms: new Date().getMilliseconds(),
      };
    }
    // Рандомное число
    function getRandomInt(min, max) {
      min = Math.ceil(min);
      max = Math.floor(max);
      return Math.floor(Math.random() * (max - min)) + min;
    }
    // Против спама
    async function antiSpam(ctx, delay = 10) {
      ctx.session.userTime = ctx.session.userTime || getTime(ctx.message.date);
      ctx.session.userReg = ctx.session.userReg || false;
      ctx.session.warn = ctx.session.warn || false;
      //console.log(ctx.session.userTime.s, getTime(ctx.message.date).s);
      async function check(res) {
        if (res < delay) {
          if (!ctx.session.warn) {
            ctx.session.warn = true;
            await bot.sendMessage(
              ctx.message.peer_id,
              `⌛ Подождите еще ${delay - res} сек.`
            );
          }
          return true;
        } else {
          ctx.session.userTime = getTime(ctx.message.date);
          ctx.session.warn = false;
          return false;
        }
      }
      if (ctx.session.userTime.m === getTime(ctx.message.date).m) {
        if (ctx.session.userTime.ms === getTime(ctx.message.date).ms) {
          ctx.session.userTime = getTime(ctx.message.date);
          ctx.session.warn = false;
          return false;
        } else {
          if (!ctx.session.userReg) {
            ctx.session.userReg = true;
            return false;
          }
          return await check(
            getTime(ctx.message.date).s - ctx.session.userTime.s
          );
        }
      } else {
        let res = 60 - (ctx.session.userTime.s - getTime(ctx.message.date).s);
        return await check(res);
      }
    }
    // Меняем статус пользователя
    function getStatus(respect, report, user) {
      if (respect / report > 2) {
        if (user.sex === 1) return "Респектабельная";
        return "Респектабельный";
      }
      if (respect / report >= 1) {
        if (user.sex === 1) return "Ровная";
        return "Ровный";
      }
      if (report > respect) {
        if (user.sex === 1) return "Вафелька";
        return "Вафля";
      }
    }
    // Кидает репорт/респект
    async function sendStateUser(ctx, reason, dropUser, dropUserID = null) {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const conversation = await bot.execute(
        "messages.getConversationMembers",
        {
          peer_id: ctx.message.peer_id,
        }
      );
      if (conversation.profiles.length === 1) {
        return ctx.reply("☢ Данная команда работает только в беседах!");
      }
      let state = findState(ctx);
      // id беседы
      const roomID = ctx.message.peer_id;
      // Получаем отправителя
      const sender = await bot.execute("users.get", {
        user_ids: ctx.message.from_id,
      });
      // Нужный пользователь с беседы
      let neededUser = null;

      if (dropUserID !== undefined && dropUser === null) {
        if (dropUserID) {
          if (dropUserID.from_id < 0) {
            if (state === "rep") return ctx.reply(`Cебе кинь &#128545;`);
            if (state === "res")
              return ctx.reply(`Пасибо, за это можешь себя похвалить ☺`);
          }
          neededUser = await getNeededUser(
            ctx,
            null,
            roomID,
            dropUserID.from_id
          );
        } else {
          return ctx.reply(
            `&#9762; Перешлите сообщение, или \n !${state} @id <можно указать причину>`
          );
        }
      } else if (dropUserID === null) {
        neededUser = await getNeededUser(ctx, dropUser, roomID, null);
      } else {
        return ctx.reply(`!${state} @id причина`);
      }
      if (state === "res") state = "respect";
      if (state === "rep") state = "report";

      if (neededUser) {
        ctx.session.reportFlag = false;
        // Создаем беседу
        function createRoomDB() {
          return room.create({
            room: roomID,
            list: [],
          });
        }
        // Отправляем результат пользователю
        function sendMessage(state, sticker, mark) {
          const flag = ctx.session.reportFlag;
          return ctx.reply(
            `@${neededUser.screen_name}(${neededUser.last_name}) ${
              neededUser.sex === 2 ? "получил" : "получила"
            } ${state} ${sticker} (${mark}1)${
              flag ? `, причина: ${reason}` : ``
            }`
          );
        }

        const hasRoom = await room.find({ room: roomID });
        if (!hasRoom[0]) await createRoomDB();

        //Отправитель кидает себе? Надо наказать!
        if (sender[0].last_name === neededUser.last_name) {
          if (state === "report")
            return ctx.reply(
              `@${neededUser.screen_name}(${neededUser.last_name}), ну ты и &#129313;`
            );
          if (ctx.message.from_id === 292556963)
            return ctx.reply(
              `@${neededUser.screen_name}(${neededUser.first_name}), хорош, всегда свеж, тлеет шмаль, летит кэш, и он в дерьмо каждый день, целый день...`
            );
          state = "report";
          reason = "любопытный";
          ctx.session.reportFlag = true;
        }

        const hasUser = await room.find({
          room: roomID,
          "list.user": neededUser.screen_name,
        });
        if (!hasUser[0]) {
          // Пользователя нету в базе, добавляем его
          if (state === "respect") {
            room
              .updateOne(
                { room: roomID },
                {
                  $push: {
                    list: {
                      user: neededUser.screen_name,
                      firstName: neededUser.first_name,
                      lastName: neededUser.last_name,
                      status: neededUser.sex === 1 ? "Ровная" : "Ровный",
                      respect: 1,
                      report: 0,
                      merit: [reason ? reason : ""],
                      fail: [],
                    },
                  },
                }
              )
              .then(() => {
                sendMessage("респект", "&#129305;", "+");
              });
          } else if (state === "report") {
            room
              .updateOne(
                { room: roomID },
                {
                  $push: {
                    list: {
                      user: neededUser.screen_name,
                      firstName: neededUser.first_name,
                      lastName: neededUser.last_name,
                      status: neededUser.sex === 1 ? "Вафелька" : "Вафля",
                      respect: 0,
                      report: 1,
                      merit: [],
                      fail: [reason ? reason : ""],
                    },
                  },
                }
              )
              .then(() => {
                sendMessage("репорт", "&#128078;", "-");
              });
          }
        } else {
          // Пользователь есть в базе
          const findState = await room.findOne({
            room: roomID,
            "list.user": neededUser.screen_name,
          });
          let report =
            findState.list.filter(
              (profile) => profile.user === neededUser.screen_name
            )[0].report || 0;
          let respect =
            findState.list.filter(
              (profile) => profile.user === neededUser.screen_name
            )[0].respect || 0;
          let merit =
            findState.list.filter(
              (profile) => profile.user === neededUser.screen_name
            )[0].merit || [];
          let fail =
            findState.list.filter(
              (profile) => profile.user === neededUser.screen_name
            )[0].fail || [];
          if (state === "respect") {
            respect += 1;
            let arMerit = [...merit];
            if (reason) {
              arMerit = [...merit, reason];
            }
            room
              .updateOne(
                { room: roomID, "list.user": neededUser.screen_name },
                {
                  $set: {
                    "list.$.respect": respect,
                    "list.$.report": report,
                    "list.$.status": getStatus(respect, report, neededUser),
                    "list.$.merit": arMerit,
                  },
                }
              )
              .then(() => {
                sendMessage("респект", "&#129305;", "+");
              });
          } else if (state === "report") {
            report += 1;
            let arFail = [...fail];
            if (reason) {
              arFail = [...fail, reason];
            }
            room
              .updateOne(
                { room: roomID, "list.user": neededUser.screen_name },
                {
                  $set: {
                    "list.$.report": report,
                    "list.$.respect": respect,
                    "list.$.status": getStatus(respect, report, neededUser),
                    "list.$.fail": arFail,
                  },
                }
              )
              .then(() => {
                sendMessage("репорт", "&#128078;", "-");
              });
          }
        }
      } else {
        ctx.reply(
          `Пользователя @${dropUser} не существует, обратитесь к своему психотерапевту &#129301;`
        );
      }
    }
    // Выполнить функцию под админом
    async function checkAdmin(ctx, callback) {
      try {
        const res = await bot.execute("messages.getConversationMembers", {
          peer_id: ctx.message.peer_id,
        });
        const admins = res.items
          .filter((item) => item.is_admin)
          .filter((admin) => admin.member_id === ctx.message.from_id);
        if (admins.length > 0) {
          callback();
        } else {
          if (res.profiles.length === 1) return callback();
          ctx.reply("&#9762; Доступ запрещен, вы не администратор!");
        }
      } catch (err) {
        ctx.reply("☢ Для выполнения этой команды, боту нужна админка!");
      }
    }
    // Получить посты группы или кол-во записей
    async function getPosts(ownerID, count, offset, getLength) {
      const { response } = await api("wall.get", {
        owner_id: ownerID,
        count,
        offset,
        access_token: config.get("access_token"),
      });
      if (getLength) return response.count;
      return response.items;
    }
    // Получить посты по фильтру (video, photo, text)
    async function getFilterPosts(
      groupID,
      countPosts,
      offsetPosts,
      postType = "photo"
    ) {
      const posts = await getPosts(groupID, countPosts, offsetPosts);
      const filterPosts = posts.filter((el) => {
        if (Array.isArray(el.attachments)) {
          const type = el.attachments[0].type;
          return type === postType;
        } else {
          return postType === "text";
        }
      });
      if (filterPosts.length < 1) {
        return getFilterPosts(groupID, countPosts, offsetPosts, postType);
      } else {
        return filterPosts;
      }
    }
    // Получить случайный, нужный пост
    async function giveRandomPost(ctx, groups, type) {
      ctx.session.group = "";
      try {
        // Выводит пост
        function sendPost(conversationID) {
          if (type === "video") {
            bot.sendMessage(
              conversationID,
              "",
              `${type}${post.owner_id}_${post.id}`
            );
          } else if (type === "text") {
            bot.sendMessage(conversationID, `${post.text}\n\n${source}`);
          } else {
            bot.sendMessage(
              conversationID,
              `${source}`,
              `${type}${post.owner_id}_${post.id}`
            );
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
        const posts = await getFilterPosts(
          ctx.session.group,
          count,
          offset,
          type
        );
        // Получаем случайный пост
        const randomPost = posts[getRandomInt(0, posts.length)];
        // Пост
        let post = {};
        if (type !== "text") {
          post = randomPost.attachments[0][type];
        } else {
          post = randomPost;
        }
        if (!post)
          return bot.sendMessage(
            ctx.message.peer_id,
            `☢ Блин блинский, давай еще раз(`
          );
        // Выводим пост
        sendPost(ctx.message.peer_id);
      } catch (err) {
        if (err.response.error_code === 29) {
          ctx.reply(
            "📈 Превышен лимит, через сутки лимит возобнавится \n [ВК дает 5000 запросов в сутки]"
          );
        } else {
          ctx.reply("☢ Блин блинский, не могу выдать [giveRandomPost]");
        }
        console.error(err);
      }
    }
    // Получить меню для игры в "21"
    function showButtons21(conversationID) {
      bot.sendMessage(
        conversationID,
        "🎯 Игра в 21 (beta version)",
        null,
        Markup.keyboard(
          [
            Markup.button({
              action: {
                type: "text",
                payload: JSON.stringify({
                  action: "takeCards",
                }),
                label: "Взять карты",
              },
            }),
            Markup.button({
              action: {
                type: "text",
                payload: JSON.stringify({
                  action: "takeCard",
                }),
                label: "Взять еще",
              },
            }),
            Markup.button({
              action: {
                type: "text",
                payload: JSON.stringify({
                  action: "giveTop",
                }),
                label: "Топ челов",
              },
            }),
            Markup.button({
              action: {
                type: "text",
                payload: JSON.stringify({
                  action: "giveRule",
                }),
                label: "Правила",
              },
            }),
            Markup.button({
              action: {
                type: "text",
                payload: JSON.stringify({
                  action: "showCards",
                }),
                label: "Показать карты",
              },
            }),
          ],
          { columns: 2 }
        ).inline()
      );
    }
    // Получить меню для игры в "Русскую рулетку"
    function showButtonsRoulette(conversationID) {
      bot.sendMessage(
        conversationID,
        "Русская рулетка ( ͝ಠ ʖ ಠ)=ε/̵͇̿̿/’̿’̿ ̿ ",
        null,
        Markup.keyboard(
          [
            Markup.button({
              action: {
                type: "text",
                payload: JSON.stringify({
                  action: "takeRoulette",
                }),
                label: "Взять револьвер",
              },
            }),
            Markup.button({
              action: {
                type: "text",
                payload: JSON.stringify({
                  action: "rouletteRoll",
                }),
                label: "Крутить барабан",
              },
            }),
            Markup.button({
              action: {
                type: "text",
                payload: JSON.stringify({
                  action: "rouletteShoot",
                }),
                label: "Стрельнуть",
              },
            }),
            Markup.button({
              action: {
                type: "text",
                payload: JSON.stringify({
                  action: "rouletteTop",
                }),
                label: "Топ",
              },
            }),
          ],
          { columns: 1 }
        ).inline()
      );
    }
    // Выбрать предметы для использования
    async function showButtonsLoot(conversationID, user) {
      try {
        bot.sendMessage(
          conversationID,
          "select loot",
          null,
          Markup.keyboard(
            [
              Markup.button({
                action: {
                  type: "text",
                  payload: JSON.stringify({
                    action: "throwGlove",
                    user,
                  }),
                  label: "🥊",
                },
              }),
              Markup.button({
                action: {
                  type: "text",
                  payload: JSON.stringify({
                    action: "throwBeer",
                    user,
                  }),
                  label: "🍻",
                },
              }),
              Markup.button({
                action: {
                  type: "text",
                  payload: JSON.stringify({
                    action: "throwWeed",
                    user,
                  }),
                  label: "🌿",
                },
              }),
            ],
            { columns: 3 }
          ).inline()
        );
      } catch (err) {
        console.error(err);
      }
    }
    // Выдать нужную фотографию из альбома группы
    async function getPictureFromAlbum(ctx, text, albumID = 275086127) {
      try {
        const { response } = await api("photos.get", {
          owner_id: -201031864,
          album_id: albumID,
          access_token: config.get("access_token"),
        });
        const pictures = response.items;
        const picture = pictures.filter((el) => el.text === text)[0];
        return `photo${picture.owner_id}_${picture.id}`;
      } catch (err) {
        console.error(err);
        ctx.reply("☢ Блин блинский, не могу выдать [getPictureFromAlbum]");
      }
    }
    // Выдать пользователю картинку - кем он является
    async function sendUserWhoHe(ctx, arPerson, albumID = 275086127) {
      try {
        const userID = ctx.message.from_id;
        const randomItem = arPerson[getRandomInt(0, arPerson.length)];
        const picture = await getPictureFromAlbum(ctx, randomItem, albumID);
        const user = await getUser(userID);
        ctx.reply(`${user.first_name}, ты ${randomItem}`, picture);
      } catch (err) {
        console.error(err);
        ctx.reply("☢ Блин блинский, не могу выдать [sendUserWhoHe]");
      }
    }
    //==========================================================================================
    // Отправить сссылку на инструцию по использованию бота
    bot.command(/^!(help|хелп|помощь)$/, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const res = await getPosts(-201031864, 1, 0);
      const insructionLink = res[0].attachments[0].link.url;
      const insructionTitle = res[0].attachments[0].link.title;
      ctx.reply(insructionTitle + "\n" + insructionLink);
    });
    //===================
    // МИНИ-ИГРЫ /(-+)\
    //===================
    // Игра "21"
    bot.command(/^!21$/, async (ctx) => {
      const spam = await antiSpam(ctx, 2);
      if (spam) return;
      showButtons21(ctx.message.peer_id);
    });
    // Игра "Русская рулетка"
    bot.command(/^!rr$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 2);
      if (spam) return;
      showButtonsRoulette(ctx.message.peer_id);
    });
    // Игра "Монетка"
    bot.command(/^!(монетка|м)$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 3);
      if (spam) return;
      const user = await getUser(ctx.message.from_id, "gen");
      const side = getRandomInt(0, 2);
      ctx.reply(
        `у ${user.first_name} ${side === 0 ? "выпала Решка" : "выпал Орёл"}`
      );
    });
    // Игра "ROLL"
    bot.command(/^!(roll|ро(л|лл))$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 3);
      if (spam) return;
      const user = await getUser(ctx.message.from_id, "gen");
      const count = getRandomInt(0, 101);
      ctx.reply(`у ${user.first_name}: ${count}`);
    });
    // Игра "Шар судьбы"
    bot.command(/^!8\s[a-zа-я0-9\W]+$/, (ctx) => {
      arAnswers = [
        "Нет",
        "Да",
        "Определенно",
        "Вероятно",
        "Есть сомнения",
        "Забудь об этом",
        "Шансы хорошие",
        "Преспективы не очень хорошие",
        "Можешь быть уверен в этом",
        "Не могу сказать",
        "Возможно",
        "Можешь быть уверен в этом",
        "Духи говорят - да",
        "Нет",
        "Шансы плохие",
        "Весьма сомнительно",
        "Может быть",
        "Никаких сомнений",
        "Вероятнее всего",
        "Скорее всего да",
        "Скорее всего нет",
        "Духи говорят - нет",
      ];
      return ctx.reply("🎱 " + arAnswers[getRandomInt(0, arAnswers.length)]);
    });
    //==========================================================================================
    // Убрать у бота кнопки
    bot.command(/^!btn\sdel$/, async (ctx) => {
      function delButtons(ctx) {
        ctx.reply("Кнопки убраны &#127918;", null, Markup.keyboard([]));
      }
      checkAdmin(ctx, delButtons.bind(null, ctx));
    });
    // Активировать у бота кнопки
    bot.command(/^!btn$/, (ctx) => {
      function addButtons(ctx) {
        ctx.reply(
          "Кнопки активированы &#127918;",
          null,
          Markup.keyboard([
            [
              Markup.button("Видос 🎬", "default"),
              Markup.button("Анекдот 😆", "default"),
              Markup.button("Мемас 🐸", "default"),
            ],
            [
              Markup.button("Gachi 🍆", "default"),
              Markup.button("Мужик в пиве 🍺", "default"),
            ],
          ])
        );
      }
      checkAdmin(ctx, addButtons.bind(null, ctx));
    });
    // Активировать у бота кнопку для игры 21
    bot.command(/^!btn 21$/, (ctx) => {
      function addButton21(ctx) {
        ctx.reply(
          "Кнопка для игры в 21 активирована &#127918;",
          null,
          Markup.keyboard([
            [
              Markup.button({
                action: {
                  type: "text",
                  payload: JSON.stringify({
                    action: "showBtn",
                  }),
                  label: "🎯 21",
                },
              }),
            ],
          ])
        );
      }
      checkAdmin(ctx, addButton21.bind(null, ctx));
    });
    //==========================================================================================
    // Система уважений и жалоб (респектов/репортов)
    bot.command(
      /!(report|respect|res|rep)\s\[[\w]+\W@[\w-]+\]\s[a-zа-я0-9\W]+/i,
      async (ctx) => {
        // Пользователя которого ввели
        const dropUser = ctx.message.text.match(/@[\w-]+/gi)[0].slice(1);
        // Причина репорта/респекта
        let reason = ctx.message.text
          .split(" ")
          .filter((_, i) => i !== 0 && i !== 1)
          .join(" ");
        sendStateUser(ctx, reason, dropUser);
      }
    );
    bot.command(
      /!(report|respect|res|rep)\s\[[\w]+\W@[\w-]+\]/i,
      async (ctx) => {
        // Пользователя которого ввели
        const dropUser = ctx.message.text.match(/@[\w-]+/gi)[0].slice(1);
        sendStateUser(ctx, null, dropUser);
      }
    );
    bot.command(/!(report|respect|res|rep)\s[a-zа-я0-9\W]+/i, async (ctx) => {
      let dropUserID = ctx.message.fwd_messages[0];
      // Причина репорта/респекта
      let reason = ctx.message.text
        .split(" ")
        .filter((_, i) => i !== 0)
        .join(" ");
      sendStateUser(ctx, reason, null, dropUserID);
    });
    bot.command(/!(report|respect|res|rep)/i, async (ctx) => {
      let dropUserID = ctx.message.fwd_messages[0];
      sendStateUser(ctx, null, null, dropUserID);
    });
    //==========================================================================================
    // Рандомное видео из группы VK
    bot.command(/(video|видос)/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const arVideoGroups = [-30316056, -167127847]; // Список групп (id)
      giveRandomPost(ctx, arVideoGroups, "video");
    });
    // Последнее видео из группы VK
    bot.command(/^!(video|вид(ео|ос))\s(last|ласт)$/, async (ctx) => {
      try {
        const spam = await antiSpam(ctx, 5);
        if (spam) return;
        const arVideoGroups = [-30316056, -167127847]; // Список групп (id)
        const randomGroupVideo =
          arVideoGroups[getRandomInt(0, arVideoGroups.length)];
        const videoPosts = await getFilterPosts(
          randomGroupVideo,
          20,
          0,
          "video"
        );
        const video = videoPosts[0].attachments[0].video;
        bot.sendMessage(
          ctx.message.peer_id,
          "",
          `video${video.owner_id}_${video.id}`
        );
      } catch (err) {
        console.error(err);
        ctx.reply("&#9762; Блин блинский, не могу выдать [video_last]");
      }
    });
    //==========================================================================================
    // Случайный мем из группы VK
    bot.command(/^!быдломем$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 3);
      if (spam) return;
      const arMemGroups = [-45745333, -162541031, -23246051]; // Список групп (id)
      giveRandomPost(ctx, arMemGroups, "photo");
    });
    bot.command(/(me(m|es)|ме(м|мес|мчик|мас))/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const arMemGroups = [-45745333, -155464693, -163058008]; // Список групп (id)
      giveRandomPost(ctx, arMemGroups, "photo");
    });
    //==========================================================================================
    // Случайный анекдот для дедов
    bot.command(/^!(anec old|анек олд|анекдот олд)$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      async function getAnecdote() {
        try {
          return axios
            .get("http://rzhunemogu.ru/RandJSON.aspx?CType=11", {
              responseType: "arraybuffer",
              responseEncoding: "binary",
            })
            .then((response) =>
              iconv.decode(Buffer.from(response.data), "windows-1251")
            );
        } catch (err) {
          console.error(err);
          ctx.reply("&#9762; Блин блинский, не могу выдать [anec_old]");
        }
      }
      getAnecdote(ctx).then((data) => {
        let anecdote = data.replace(/\{"content":"/, "");
        anecdote = anecdote.split('"}')[0];
        ctx.reply(anecdote);
      });
    });
    //==========================================================================================
    // Случайный анекдот из группы VK
    bot.command(/(ане(к|дот(ы)))/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const arAnecGroups = [-149279263]; // Список групп (id)
      giveRandomPost(ctx, arAnecGroups, "text");
    });
    //==========================================================================================
    // Кто я из - отправялет случайного персонажа пользователю
    bot.command(/^кто я из реальных пацанов$/, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const arRealGuys = [
        "Антоха",
        "Арменка",
        "Валя",
        "Базанов",
        "Колян",
        "Вован",
        "Гена",
        "Ковальчук",
        "Маринка",
        "Машка",
        "Эдик",
        "Игорь Сергеевич",
        "Сергей Иванович",
      ];
      sendUserWhoHe(ctx, arRealGuys, 275747257);
    });
    bot.command(/^кто я из доты$/, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const arDoters = [
        "водный",
        "анти крип",
        "крипочек",
        "огры маги",
        "падж танцор",
        "петух",
        "axe",
        "пудж охотник",
        "пудж с украины",
        "рудге инвалидус",
        "чёрный",
        "пудж с завода",
        "школьный пуджик",
        "гнида",
        "wk papi4",
        "слепыш",
        "шляпа усатая",
        "крыса",
        "колхозник",
        "некрофил",
        "лёха",
        "дерево",
        "рыжая оторва",
        "сосалка местного двора",
        "пенёк",
        "чечен",
      ];
      sendUserWhoHe(ctx, arDoters, 275750553);
    });
    bot.command(/^какая я дора$/, async (ctx) => {
      const spam = await antiSpam(ctx, 3);
      if (spam) return;
      const arDoters = [
        "дора с палкой в жопе",
        "дора с шизой",
        "ДУРА, НЕ СТРЕЛЯЙ БЛЯТЬ",
        "дора постельный клоп",
        "дора дзен",
        "дора кьют-рокерша🎸",
        "дора, срущая за гаражом💩",
        "дора раста🍀",
        "дора под салями",
        "голодная дора🤤",
        "дора зайка☺",
      ];
      sendUserWhoHe(ctx, arDoters, 277011573);
    });
    //==========================================================================================
    // Выдаёт нужные картинки по сообщению пользователя
    bot.command(/(мужика в пиве|мужик в пиве|пиво в мужике)/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "Мужик в пиве");
      ctx.reply("", picture);
    });
    bot.command(/(ст(е|э)тх(е|э|а)м)/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "стейтем");
      ctx.reply("", picture);
    });
    bot.command(/(п(у|а)д(ж|жик)|(п|р)(у|а)дге|pudge|быдло)/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "пудж");
      ctx.reply("", picture);
    });
    bot.command(/(сует(а|у))/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "суета");
      ctx.reply("", picture);
    });
    bot.command(/(пам(-|\s)парам)/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "пам-парам");
      ctx.reply("", picture);
    });
    bot.command(/папич/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "папич");
      ctx.reply("", picture);
    });
    bot.command(/ныаа/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "ныа");
      ctx.reply("", picture);
    });
    bot.command(/(классика|classic)/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "классика");
      ctx.reply("", picture);
    });
    bot.command(/баян/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "баян");
      ctx.reply("", picture);
    });
    bot.command(
      /(заеб(умба|ись)|збс|ч(е|ё|о)тк(о|а)|внатуре|класс|мог(ё|е)те)/i,
      async (ctx) => {
        const spam = await antiSpam(ctx, 5);
        if (spam) return;
        const picture = await getPictureFromAlbum(ctx, "чотко");
        ctx.reply("", picture);
      }
    );
    bot.command(
      /(хапать|накурите|курить|напас|косяк|нахапайте|хапнем|накуриться)/i,
      async (ctx) => {
        const spam = await antiSpam(ctx, 5);
        if (spam) return;
        const picture = await getPictureFromAlbum(ctx, "smoke");
        ctx.reply("", picture);
      }
    );
    bot.command(/(кай(ф|фую)|каеф)/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "кайф");
      ctx.reply("", picture);
    });
    bot.command(/(заня(т|той)|у меня дела)/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "занят");
      ctx.reply("", picture);
    });
    bot.command(/займите/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "займите");
      ctx.reply("", picture);
    });
    bot.command(/хокаге/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "хокаге");
      ctx.reply("", picture);
    });
    bot.command(
      /(горин|холодильник|что вы делаете в моем холодильнике|кушац)/i,
      async (ctx) => {
        const spam = await antiSpam(ctx, 5);
        if (spam) return;
        const picture = await getPictureFromAlbum(ctx, "горин");
        ctx.reply("", picture);
      }
    );
    bot.command(
      /^не(п|\sп)овезло|не(п|\sп)овезло\sне(п|\sп)овезло$/i,
      async (ctx) => {
        const spam = await antiSpam(ctx, 5);
        if (spam) return;
        const picture = await getPictureFromAlbum(ctx, "не повезло");
        ctx.reply("", picture);
      }
    );
    bot.command(/^(повезло\sповезло)|повезло$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "повезло");
      ctx.reply("", picture);
    });
    bot.command(/^правила$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "правила");
      ctx.reply("", picture);
    });
    bot.command(/^отец|тяжело$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "тяжело");
      ctx.reply("", picture);
    });
    bot.command(/^!ляпин$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const picture = await getPictureFromAlbum(ctx, "ляпин");
      ctx.reply("", picture);
    });
    //==========================================================================================
    // Случайный Gachimuchi
    bot.command(/(гачи|gachi)/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      const arGachi = [
        "&#9794;fuck you&#9794;",
        "&#9794;fucking slave&#9794;",
        "&#9794;boss on this gym&#9794;",
        "&#9794;dungeon master&#9794;",
        "&#9794;swallow my cum&#9794;",
        "&#9794;fat cock&#9794;",
        "&#9794;the semen&#9794;",
        "&#9794;full master&#9794;",
        "&#9794;drop of cum&#9794;",
        "&#9794;Billy&#9794;",
        "&#9794;do anal&#9794;",
        "&#9794;get your ass&#9794;",
        "&#9794;fisting anal&#9794;",
        "&#9794;long latex cock&#9794;",
        "&#9794;do finger in ass&#9794;",
        "&#9794;leatherman&#9794;",
        "&#9794;dick&#9794;",
        "&#9794;gay&#9794;",
        "&#9794;have nice ass&#9794;",
        "&#9794;boy next door&#9794;",
        "&#9794;Van&#9794;",
        "&#9794;leather stuff&#9794;",
        "уклонился от gachimuchi",
      ];
      try {
        const conversationID = ctx.message.peer_id;
        const conversation = await bot.execute(
          "messages.getConversationMembers",
          {
            peer_id: conversationID,
          }
        );
        const randomPerson =
          conversation.profiles[getRandomInt(0, conversation.profiles.length)];
        const randomGachi = arGachi[getRandomInt(0, arGachi.length - 1)];
        ctx.reply(
          `@${randomPerson.screen_name}(${randomPerson.last_name}) ${randomGachi}`
        );
      } catch (err) {
        ctx.reply("&#9762; Для работы бота нужна админка!");
      }
    });
    // Посмореть статистику пользователя по респеткам/репортам
    async function showStatus(ctx, user) {
      const neededUser = await getNeededUser(ctx, user, ctx.message.peer_id);
      if (neededUser) {
        const roomID = ctx.message.peer_id;
        const findUser = await room.findOne({
          room: roomID,
          "list.user": neededUser.screen_name,
        });
        let statusUser = null;

        if (findUser) {
          statusUser = findUser.list.filter((profile) => {
            return profile.user === neededUser.screen_name;
          })[0];
        }

        if (!statusUser.status)
          return ctx.reply(
            `&#128203; О пользователе @${user} ничего не слышно...`
          );

        const merit = statusUser.merit.join(", ");
        const fail = statusUser.fail.join(", ");
        ctx.reply(
          `@${statusUser.user}(${neededUser.last_name}) — ${statusUser.status}\n(Респектов: ${statusUser.respect} | Репортов: ${statusUser.report})\nЗаслуги: ${merit}\nКосяки: ${fail}`
        );
      } else {
        ctx.reply(
          `Пользователя @${user} не существует, обратитесь к своему психотерапевту &#129301;`
        );
      }
    }
    bot.command(/^!(status|st)\s\[[\w]+\W@[\w-]+\]$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 3);
      if (spam) return;
      const conversation = await bot.execute(
        "messages.getConversationMembers",
        {
          peer_id: ctx.message.peer_id,
        }
      );
      if (conversation.profiles.length === 1) {
        return ctx.reply("☢ Данная команда работает только в беседах!");
      }
      const user = ctx.message.text.match(/@[\w-]+/gi)[0].slice(1);
      await showStatus(ctx, user);
    });
    bot.command(/^!(status|st)$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 3);
      if (spam) return;
      const conversation = await bot.execute(
        "messages.getConversationMembers",
        {
          peer_id: ctx.message.peer_id,
        }
      );
      if (conversation.profiles.length === 1) {
        return ctx.reply("☢ Данная команда работает только в беседах!");
      }
      const dropUser = ctx.message.fwd_messages[0];
      if (!dropUser) {
        //let state = ctx.message.text.match(/(status|st)/ig)[0];
        const user = await getUser(ctx.message.from_id);
        return await showStatus(ctx, user.screen_name);
      }
      const user = await getUser(dropUser.from_id);
      await showStatus(ctx, user.screen_name);
    });
    //==========================================================================================
    // Топ 10 участников по репортам/респектам
    bot.command(/^!(top|топ)\s(report|respect|res|rep)$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      let state = findState(ctx);
      if (state === "rep") state = "report";
      if (state === "res") state = "respect";
      const conversationID = ctx.message.peer_id;
      try {
        const room = await neededRoom(conversationID);
        function compare(a, b) {
          if (a[state] > b[state]) return -1;
          if (a[state] === a[state]) return 0;
          if (a[state] < a[state]) return 1;
        }
        const roomTop = room.list.sort(compare);
        const topList = roomTop.map((el, index) => {
          if (index < 10) {
            return `${index + 1}. ${el.firstName} ${el.lastName} - ${
              el[state]
            }\n`;
          }
        });
        ctx.reply(
          `Топ челов по ${
            state === "respect" ? "респектам &#129305;" : "репортам &#128078;"
          }\n${topList.join("")}`
        );
      } catch (err) {
        ctx.reply(
          "&#128203; Список пуст," +
            " кидайте респекты/репорты участникам беседы"
        );
      }
    });
    bot.command(/^!(top|топ)$/i, async (ctx) => {
      const spam = await antiSpam(ctx, 5);
      if (spam) return;
      ctx.reply("&#9762; !top res или rep");
    });
    //==========================================================================================
    // Очистить топ в игре 21
    bot.command(/^!21\sclear\stop$/, (ctx) => {
      async function clearTop21(ctx) {
        try {
          const rooms = JSON.parse(fs.readFileSync("./cards21.json", "utf-8"));
          const conversationID = ctx.message.peer_id;
          const neededRoom = rooms.filter(
            (el) => el.room === conversationID
          )[0];
          if (!neededRoom)
            return ctx.reply("&#9762; Список пуст, нечего чистить");
          if (neededRoom.top.length < 1)
            return ctx.reply("&#9762; Список пуст, нечего чистить");
          neededRoom.top = [];
          const arDelRoom = rooms.filter((el) => el.room !== conversationID);
          const newRooms = [neededRoom, ...arDelRoom];
          await bot.sendMessage(
            conversationID,
            "📜 Топ в игре 🎯 21 успешно очищен!"
          );
          fs.writeFileSync("./cards21.json", JSON.stringify(newRooms, null, 2));
        } catch (err) {
          console.error(err);
          ctx.reply("&#9762; Блин блинский, сбой какой-то [game 21]");
        }
      }
      checkAdmin(ctx, clearTop21.bind(null, ctx));
    });
    //==========================================================================================
    // Очистить игроков в игре 21 (Обновить игру)
    bot.command(/^!21\supdate\sgame$/, (ctx) => {
      async function updateGame21(ctx) {
        try {
          const rooms = JSON.parse(fs.readFileSync("./cards21.json", "utf-8"));
          const conversationID = ctx.message.peer_id;
          const neededRoom = rooms.filter(
            (el) => el.room === conversationID
          )[0];
          if (!neededRoom)
            return ctx.reply("&#9762; Никто не играет в 🎯 21...");
          if (neededRoom.players.length < 1)
            return ctx.reply("&#9762; Никто не играет в 🎯 21...");
          neededRoom.players = [];
          neededRoom.start = false;
          neededRoom.online = 0;
          const arDelRoom = rooms.filter((el) => el.room !== conversationID);
          const newRooms = [neededRoom, ...arDelRoom];
          await bot.sendMessage(
            conversationID,
            "Игра в 🎯 21 обновлена",
            null,
            Markup.keyboard([
              Markup.button({
                action: {
                  type: "text",
                  payload: JSON.stringify({
                    action: "takeCards",
                  }),
                  label: "Взять карты",
                },
              }),
            ]).inline()
          );
          fs.writeFileSync("./cards21.json", JSON.stringify(newRooms, null, 2));
        } catch (err) {
          console.error(err);
          ctx.reply("&#9762; Блин блинский, сбой какой-то [update_21]");
        }
      }
      checkAdmin(ctx, updateGame21.bind(null, ctx));
    });
    // secret command
    bot.command(/^!21 clrg$/, (ctx) => {
      function clearGame21() {
        fs.writeFileSync("./cards21.json", JSON.stringify([], null, 2));
      }
      checkAdmin(ctx, clearGame21.bind(null, ctx));
    });
    // LOOT INVENTORY
    bot.command(/^!inv$/, async (ctx) => {
      const roomID = ctx.message.peer_id;
      const userID = ctx.message.from_id;
      try {
        const conversation = await bot.execute(
          "messages.getConversationMembers",
          {
            peer_id: roomID,
          }
        );
        if (conversation.profiles.length === 1) {
          return ctx.reply("☢ Данная команда работает только в беседах!");
        }
        const user = await getUser(userID);
        const neededRoom = await room.findOne({
          room: roomID,
          "list.user": user.screen_name,
        });
        if (!neededRoom)
          return await bot.sendMessage(userID, "☢ У вас нету лута ;(");
        const neededUser = neededRoom.list.filter(
          (el) => el.user === user.screen_name
        )[0];
        if (typeof neededUser.inventory[arItems[0].name] !== "number")
          return await bot.sendMessage(userID, "☢ У вас нету лута ;(");

        const items = [...Object.keys(neededUser.inventory)];
        items.splice(0, 1);
        inventoryItems = items
          .map((el) => {
            const symbol = arItems.filter((i) => i.name === el)[0].symbol;
            return `${symbol} ${el}: ${neededUser.inventory[el]} шт.\n`;
          })
          .join("");
        const buffWeed = neededUser.buff.weed ? "есть" : "нету";
        const buffBeer = neededUser.buff.beer ? "есть" : "нету";
        // Отправить инвентарь в лс челу
        await bot.sendMessage(
          userID,
          `${inventoryItems}\nБаф пива: ${buffBeer}\nБаф травы: ${buffWeed}\n(Респектов: ${neededUser.respect} | Репортов: ${neededUser.report})`
        );
      } catch (err) {
        console.error(err);
        bot.sendMessage(
          roomID,
          `💼 Напишиту боту (что угодно), и бот сможет выдавать вам инвентарь!`,
          null,
          Markup.keyboard([
            Markup.button({
              action: {
                type: "open_link",
                link: "https://vk.com/im?media=&sel=-201031864",
                label: "Написать",
              },
            }),
          ]).inline()
        );
      }
    });
    // LOOT USE
    bot.command(/^!use\s\[[\w]+\W@[\w-]+\]$/, async (ctx) => {
      const dropUser = ctx.message.text.match(/@[\w-]+/gi)[0].slice(1);
      try {
        const conversation = await bot.execute(
          "messages.getConversationMembers",
          {
            peer_id: ctx.message.peer_id,
          }
        );
        if (conversation.profiles.length < 2) {
          return ctx.reply("☢ Данная команда работает только в беседах!");
        }
        showButtonsLoot(ctx.message.peer_id, dropUser);
      } catch (err) {
        console.error(err);
      }
    });
    bot.command(/^!use$/, async (ctx) => {
      const dropUser = ctx.message.fwd_messages[0];
      try {
        const conversation = await bot.execute(
          "messages.getConversationMembers",
          {
            peer_id: ctx.message.peer_id,
          }
        );
        if (conversation.profiles.length < 2) {
          return ctx.reply("☢ Данная команда работает только в беседах!");
        }
        let user = {};
        if (!dropUser) {
          user = await getUser(ctx.message.from_id);
        } else {
          user = await getUser(dropUser.from_id);
        }
        showButtonsLoot(ctx.message.peer_id, user.screen_name);
      } catch (e) {
        console.error(e);
      }
    });
    //==========================================================================================
    // Action Buttons
    bot.event("message_new", async (ctx) => {
      // GET LOOT
      if (ctx.message.attachments.length) {
        const attachemnt = ctx.message.attachments[0];
        if (attachemnt.type === "photo") {
          const conversation = await bot.execute(
            "messages.getConversationMembers",
            {
              peer_id: ctx.message.peer_id,
            }
          );
          if (conversation.profiles.length > 1) {
            let randomItem = arLoot[getRandomInt(0, arLoot.length)];
            const user = await getUser(ctx.message.from_id);
            const roomID = ctx.message.peer_id;
            let existRoom = await room.findOne({ room: roomID });
            let existUser = existRoom.list.filter(
              (el) => el.user === user.screen_name
            )[0];

            if (existUser) {
              const pictures = existUser.pictures || [];
              if (pictures.includes(attachemnt.photo.id)) {
                return;
              }
              pictures.push(attachemnt.photo.id);
              await room.updateOne(
                { room: roomID, "list.user": user.screen_name },
                {
                  $set: {
                    "list.$.pictures": pictures,
                  },
                }
              );
            } else {
              let existRoom = await room.findOne({ room: roomID });
              if (!existRoom) {
                await room.create({
                  room: roomID,
                  list: [],
                });
              }
              await room.updateOne(
                { room: roomID },
                {
                  $push: {
                    list: {
                      user: user.screen_name,
                      firstName: user.first_name,
                      lastName: user.last_name,
                      respect: 0,
                      report: 0,
                      buff: {
                        weed: false,
                        beer: false,
                      },
                      inventory: {
                        glove: 0,
                        beer: 0,
                        weed: 0,
                      },
                      pictures: [attachemnt.photo.id],
                    },
                  },
                }
              );
            }

            if (randomItem !== null) {
              randomItem = randomItem[getRandomInt(0, randomItem.length)];
              existRoom = await room.findOne({
                room: roomID,
                "list.user": user.screen_name,
              });
              existUser = existRoom.list.filter(
                (el) => el.user === user.screen_name
              )[0];
              const inventory = {
                glove: existUser.inventory.glove || 0,
                beer: existUser.inventory.beer || 0,
                weed: existUser.inventory.weed || 0,
              };
              inventory[randomItem.name] += 1;
              await room.updateOne(
                { room: roomID, "list.user": user.screen_name },
                {
                  $set: {
                    "list.$.inventory": inventory,
                  },
                }
              );
              if (typeof existUser.buff.weed !== "boolean") {
                await room.updateOne(
                  { room: roomID, "list.user": user.screen_name },
                  {
                    $set: {
                      "list.$.buff": {
                        weed: false,
                        beer: false,
                      },
                    },
                  }
                );
              }
              return ctx.reply(
                `🙊 ${user.first_name} ${
                  user.sex === 2 ? "залутал" : "залутала"
                } предмет (+1)`
              );
            }
          }
        }
      }
      if (ctx.message.payload) {
        function compare(a, b) {
          if (a.score > b.score) return -1;
          if (a.score === b.score) return 0;
          if (a.score < b.score) return 1;
        }
        async function endGame21(room, arDelRoom) {
          room.start = false;
          room.online = 0;
          let arTopPlayers = room.players.sort(compare);
          room.players = [];
          let winner = null;

          if (arTopPlayers[0].score === arTopPlayers[1].score) {
            const arPlayersEqual = arTopPlayers.filter(
              (el, idx, arr) => el.score === arr[0].score
            );
            winner = arPlayersEqual.reduce(
              (acc, current) => {
                if (new Date(acc.date) < new Date(current.date)) {
                  return acc;
                } else {
                  return current;
                }
              },
              [arPlayersEqual[1]]
            );
            await bot.sendMessage(
              conversationID,
              "🃏 Одинаковые очки, выигрывает тот, кто первый раскрылся"
            );
          } else {
            winner = arTopPlayers[0];
          }

          const user = await getUser(winner.user, "nom");
          const existTopPlayer = room.top.filter(
            (el) => el.user === winner.user
          )[0];

          if (!existTopPlayer) {
            room.top.push({
              user: winner.user,
              firstName: user.first_name,
              lastName: user.last_name,
              score: 1,
            });
          } else {
            const arDelPlayer = room.top.filter(
              (el) => el.user !== winner.user
            );
            const updatePlayer = {
              user: winner.user,
              firstName: user.first_name,
              lastName: user.last_name,
              score: existTopPlayer.score + 1,
            };
            room.top = [updatePlayer, ...arDelPlayer];
          }
          let newRooms = [room, ...arDelRoom];
          await bot.sendMessage(
            conversationID,
            `🥇 ${user.sex === 2 ? "Выиграл" : "Выиграла"} ${user.first_name} ${
              user.last_name
            }`
          );
          await fs.writeFileSync(
            "./cards21.json",
            JSON.stringify(newRooms, null, 2)
          );
        }
        async function startRouletteGame(roll, callback = null) {
          try {
            function getBullet(players) {
              if (players < 3) return getRandomInt(1, 4);
              if (players === 3) return getRandomInt(1, 5);
              if (players > 3) return getRandomInt(1, 7);
            }
            const spam = await antiSpam(ctx, 2);
            if (spam) return;
            const user = await getUser(userID);
            const existRoom = await room.findOne({ room: conversationID });
            if (!existRoom)
              return ctx.reply(`🔫 ${user.first_name}, ты не взял револьвер!`);
            const players = existRoom.roulette.players;
            const existPlayer = players.filter((el) => el.user == userID)[0];
            if (!existPlayer)
              return ctx.reply(`🔫 ${user.first_name}, ты не взял револьвер!`);
            if (players.length < 2)
              return ctx.reply(
                `🔫 Подожди хотя бы еще одного игрока, ему надо взять револьвер!`
              );
            if (!existRoom.gameStarted) {
              await room.updateOne(
                { room: conversationID },
                {
                  $set: {
                    "roulette.gameStarted": true,
                  },
                }
              );
            }
            if (!existPlayer.bullet > 0 || roll) {
              await room.updateOne(
                { room: conversationID, "roulette.players.user": userID },
                {
                  $set: {
                    "roulette.players.$.bullet": getBullet(players.length),
                  },
                }
              );
            }

            if (callback !== null) {
              callback(getBullet(players.length));
            }
          } catch (err) {
            console.error(err);
            ctx.reply("☢ Блин блинский, сбой какой-то [startRouletteGame]");
          }
        }
        const payload = JSON.parse(ctx.message.payload);
        const conversationID = ctx.message.peer_id;
        const userID = ctx.message.from_id;
        // LOOT ------------------------------------------------------------------
        async function useLoot(item, symbol, callback, callbackSelf) {
          try {
            const existRoom = await room.findOne({ room: conversationID });
            if (!existRoom)
              return ctx.reply(
                "🗿 Беседа не активна, киньте респект/репорт или залутайте предмет"
              );
            const sender = await getUser(userID);
            const existSender = existRoom.list.filter(
              (el) => el.user === sender.screen_name
            )[0];
            const existUser = existRoom.list.filter(
              (el) => el.user === payload.user
            )[0];
            if (!existSender)
              return ctx.reply(
                `🗿 ${sender.first_name}, ты на мели (${symbol} 0 шт.)`
              );
            const inventorySender = existSender.inventory;
            if (!inventorySender[item])
              return ctx.reply(
                `🗿 ${sender.first_name}, ты на мели (${symbol} 0 шт.)`
              );
            inventorySender[item] -= 1;
            await room
              .updateOne(
                { room: conversationID, "list.user": existSender.user },
                {
                  $set: {
                    "list.$.inventory": inventorySender,
                  },
                }
              )
              .then(async () => {
                if (!existSender.respect) {
                  await room.updateOne(
                    { room: conversationID, "list.user": existSender.user },
                    {
                      $set: {
                        "list.$.respect": 0,
                      },
                    }
                  );
                }
                if (!existSender.report) {
                  await room.updateOne(
                    { room: conversationID, "list.user": existSender.user },
                    {
                      $set: {
                        "list.$.report": 0,
                      },
                    }
                  );
                }
                if (!existUser.report) {
                  await room.updateOne(
                    { room: conversationID, "list.user": existUser.user },
                    {
                      $set: {
                        "list.$.report": 0,
                      },
                    }
                  );
                }
                if (!existUser.respect) {
                  await room.updateOne(
                    { room: conversationID, "list.user": existUser.user },
                    {
                      $set: {
                        "list.$.respect": 0,
                      },
                    }
                  );
                }
                const user = await getUser(payload.user);
                const owner = await getUser(existSender.user);
                const ownerGen = await getUser(existSender.user, "gen");

                if (existSender.user === payload.user) {
                  callbackSelf.call(null, existUser, user);
                } else {
                  callback.call(
                    null,
                    existSender,
                    existUser,
                    user,
                    owner,
                    ownerGen
                  );
                }
              });
          } catch (err) {
            console.error(err);
          }
        }
        if (payload.action === "throwGlove") {
          const spam = await antiSpam(ctx, 3);
          if (spam) return;
          await useLoot(
            "glove",
            "🥊",
            async (owner, user, existUser, sender, senderGen) => {
              if (!user) {
                return ctx.reply(
                  `🤧 ${existUser.first_name} получил в тыкву от ${senderGen.first_name}\n😩 ${owner.firstName} ничего с этого не получил`
                );
              }
              if (owner.buff.weed) {
                await room.updateOne(
                  { room: conversationID, "list.user": owner.user },
                  {
                    $set: {
                      "list.$.buff.weed": false,
                    },
                  }
                );
                return ctx.reply(
                  `${owner.firstName}, ты не можешь драться из-за духовного просветления\n😴 ${owner.firstName} ушёл отсыпаться...`
                );
              }
              if (user.buff.weed === true && user.inventory.weed) {
                await room.updateOne(
                  { room: conversationID, "list.user": user.user },
                  {
                    $set: {
                      "list.$.respect": user.respect + 1,
                      "list.$.status": getStatus(
                        user.respect + 1,
                        user.report,
                        existUser
                      ),
                      "list.$.inventory.weed": user.inventory.weed - 1,
                    },
                  }
                );
                await room.updateOne(
                  { room: conversationID, "list.user": owner.user },
                  {
                    $set: {
                      "list.$.buff.weed": true,
                    },
                  }
                );
                const userGen = await getUser(user.user, "gen");
                return ctx.reply(
                  `${owner.firstName} принял растафарай от ${userGen.first_name}\n${user.firstName} угостил травкой 🌿🤙\nРебята знатно подули...`
                );
              }
              if (user.buff.weed) {
                await room.updateOne(
                  { room: conversationID, "list.user": user.user },
                  {
                    $set: {
                      "list.$.buff.weed": false,
                    },
                  }
                );
                const userGen = await getUser(user.user, "gen");
                return ctx.reply(
                  `😇 ${owner.firstName} получил духовное просветление от ${userGen.first_name}\n${user.firstName} так долго рассказывал про мир во всем мире, что его аж отпустило`
                );
              }
              if (user.buff.beer && !owner.buff.beer) {
                const userGen = await getUser(user.user, "gen");
                await room.updateOne(
                  { room: conversationID, "list.user": owner.user },
                  {
                    $set: {
                      "list.$.report": owner.report + 1,
                      "list.$.status": getStatus(
                        owner.respect,
                        owner.report + 1,
                        sender
                      ),
                    },
                  }
                );
                await room.updateOne(
                  { room: conversationID, "list.user": user.user },
                  {
                    $set: {
                      "list.$.buff.beer": false,
                      "list.$.respect": user.respect + 1,
                      "list.$.status": getStatus(
                        user.respect + 1,
                        user.report,
                        existUser
                      ),
                    },
                  }
                );
                return ctx.reply(
                  `🤧 ${owner.firstName} получил в пузо от пьяного-мастера ${userGen.first_name}\nПацаны с района дали дизреспект 👎\n${user.firstName} получил респект 🤙`
                );
              }
              if (!user.buff.beer && owner.buff.beer) {
                await room.updateOne(
                  { room: conversationID, "list.user": user.user },
                  {
                    $set: {
                      "list.$.report": user.report + 1,
                      "list.$.status": getStatus(
                        user.respect,
                        user.report + 1,
                        existUser
                      ),
                    },
                  }
                );
                await room.updateOne(
                  { room: conversationID, "list.user": owner.user },
                  {
                    $set: {
                      "list.$.buff.beer": false,
                      "list.$.respect": owner.respect + 1,
                      "list.$.status": getStatus(
                        owner.respect + 1,
                        owner.report,
                        sender
                      ),
                    },
                  }
                );
                return ctx.reply(
                  `🤧 ${user.firstName} получил в пузо от пьяного-мастера ${senderGen.first_name}\nПацаны с района дали дизреспект 👎\n${owner.firstName} получил респект 🤙`
                );
              }
              if (user.buff.beer === true && owner.buff.beer === true) {
                await room.updateOne(
                  { room: conversationID, "list.user": user.user },
                  {
                    $set: {
                      "list.$.buff.beer": false,
                    },
                  }
                );
                await room.updateOne(
                  { room: conversationID, "list.user": owner.user },
                  {
                    $set: {
                      "list.$.buff.beer": false,
                    },
                  }
                );
                return ctx.reply(
                  `${user.firstName} и ${owner.firstName} бухие орали матом и 🥊 дрались под окнами\n👵 Бабка вызвала сотрудников 👮‍♀🚔\nИм пришлось скрыться с места происшествия...`
                );
              }
              if (!user.respect) {
                if (user.inventory.glove) {
                  await room
                    .updateOne(
                      { room: conversationID, "list.user": user.user },
                      {
                        $set: {
                          "list.$.inventory.glove": user.inventory.glove - 1,
                        },
                      }
                    )
                    .then(() => {
                      return ctx.reply(
                        `Началась суета...у обоих есть 🥊\nНо к сожалению, махач разняли сотрудники 👮‍♀🚔`
                      );
                    });
                }
                return ctx.reply(
                  `🤧 ${user.firstName} получил в тыкву от ${senderGen.first_name}\n😩 ${owner.firstName} ничего с этого не получил`
                );
              }
              if (user.inventory.glove) {
                const countOwner = getRandomInt(0, 2) * owner.inventory.glove;
                const countUser = getRandomInt(0, 2) * user.inventory.glove;
                async function userWin() {
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.inventory.glove": user.inventory.glove - 1,
                        "list.$.respect": user.respect + 1,
                        "list.$.status": getStatus(
                          user.respect + 1,
                          user.report,
                          existUser
                        ),
                      },
                    }
                  );
                  await room
                    .updateOne(
                      { room: conversationID, "list.user": owner.user },
                      {
                        $set: {
                          "list.$.report": owner.report + 1,
                          "list.$.status": getStatus(
                            owner.respect,
                            owner.respect + 1,
                            sender
                          ),
                        },
                      }
                    )
                    .then(() => {
                      return ctx.reply(
                        `Началась суета...у обоих есть 🥊\n🤧 ${owner.firstName} проиграл в драке... 👎\n😎 ${user.firstName} получил респект 🤙`
                      );
                    });
                }
                if (countOwner > countUser) {
                  await ownerWin();
                } else if (countOwner < countUser) {
                  await userWin();
                } else {
                  if (getRandomInt(0, 2) === 0) {
                    await ownerWin();
                  } else {
                    await userWin();
                  }
                }
              } else {
                await ownerWin(
                  `🤧 ${user.firstName} получил в тыкву от ${senderGen.first_name}\n😎 ${owner.firstName} отжал респект 🤙`
                );
              }
              async function ownerWin(mes = null) {
                await room.updateOne(
                  { room: conversationID, "list.user": owner.user },
                  {
                    $set: {
                      "list.$.respect": owner.respect + 1,
                      "list.$.status": getStatus(
                        owner.respect + 1,
                        owner.report,
                        sender
                      ),
                    },
                  }
                );
                await room
                  .updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.inventory.glove": mes
                          ? 0
                          : user.inventory.glove - 1,
                        "list.$.respect": user.respect - 1,
                        "list.$.status": getStatus(
                          user.respect - 1,
                          user.report,
                          existUser
                        ),
                      },
                    }
                  )
                  .then(() => {
                    return ctx.reply(
                      mes ||
                        `Началась суета...у обоих есть 🥊\n🤧 ${user.firstName} получил в тыкву от ${senderGen.first_name} 👎\n😎 ${owner.firstName} отжал респект 🤙`
                    );
                  });
              }
            },
            async (existUser, user) => {
              await room
                .updateOne(
                  { room: conversationID, "list.user": existUser.user },
                  {
                    $set: {
                      "list.$.report": existUser.report + 1,
                      "list.$.status": getStatus(
                        existUser.respect,
                        existUser.report + 1,
                        user
                      ),
                    },
                  }
                )
                .then(() => {
                  return ctx.reply(
                    `🤪 ${user.first_name} ${
                      user.sex === 2 ? "настучал" : "настучала"
                    } себе по морде 👎\n🤕🚑 Увезли в дурку...`
                  );
                });
            }
          );
        }
        if (payload.action === "throwBeer") {
          const spam = await antiSpam(ctx, 3);
          if (spam) return;
          await useLoot(
            "beer",
            "🍻",
            async (owner, user, existUser, sender, senderGen) => {
              if (!user) {
                return ctx.reply(
                  `😕 ${existUser.first_name} отказался от 🍻 пивасика ${senderGen.first_name}`
                );
              }
              if (user.buff.beer) {
                const answer = [true, false];
                if (answer[getRandomInt(0, 2)] === false) {
                  return ctx.reply(
                    `🥴 ${existUser.first_name} отказался от 🍻 пивасика ${senderGen.first_name}\nВидимо, уже пьяненький...`
                  );
                } else {
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.report": user.report + 1,
                        "list.$.status": getStatus(
                          user.respect,
                          user.report + 1,
                          existUser
                        ),
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": false,
                      },
                    }
                  );
                  return ctx.reply(
                    `🥴 ${user.firstName} согласился ещё бахнуть\n🤢 ${user.firstName} перепил пива\n🤮 наблювал в беседе 👎`
                  );
                }
              }
              if (user.inventory.beer) {
                if (owner.buff.beer && !user.buff.beer) {
                  await room.updateOne(
                    { room: conversationID, "list.user": owner.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": false,
                        "list.$.report": owner.report + 1,
                        "list.$.status": getStatus(
                          owner.respect,
                          owner.report + 1,
                          sender
                        ),
                      },
                    }
                  );
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": true,
                        "list.$.inventory.beer": user.inventory.beer - 1,
                      },
                    }
                  );
                  return ctx.reply(
                    `У каждого при себе 🍻\n🥴 ${owner.firstName} и ${user.firstName} нажрались\n🤢 ${owner.firstName} перепил\n🤮 наблювал в беседе 👎`
                  );
                }
                if (!owner.buff.beer && user.buff.beer) {
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": false,
                        "list.$.report": user.report + 1,
                        "list.$.status": getStatus(
                          user.respect,
                          user.report + 1,
                          existUser
                        ),
                        "list.$.inventory.beer": user.inventory.beer - 1,
                      },
                    }
                  );
                  await room.updateOne(
                    { room: conversationID, "list.user": owner.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": true,
                      },
                    }
                  );
                  return ctx.reply(
                    `У каждого при себе 🍻\n🥴 ${owner.firstName} и ${user.firstName} нажрались\n🤢 ${user.firstName} перепил\n🤮 наблювал в беседе 👎`
                  );
                }
                if (owner.buff.beer === true && user.buff.beer === true) {
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": false,
                        "list.$.report": user.report + 1,
                        "list.$.status": getStatus(
                          user.respect,
                          user.report + 1,
                          existUser
                        ),
                        "list.$.inventory.beer": user.inventory.beer - 1,
                      },
                    }
                  );
                  await room.updateOne(
                    { room: conversationID, "list.user": owner.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": false,
                        "list.$.report": owner.report + 1,
                        "list.$.status": getStatus(
                          owner.respect,
                          owner.report + 1,
                          sender
                        ),
                      },
                    }
                  );
                  return ctx.reply(
                    `У каждого при себе 🍻\n🥴 ${owner.firstName} и ${user.firstName} нажрались\n🤢 Ребята перепили\n🤮 наблювали в беседе 👎`
                  );
                }
                await room.updateOne(
                  { room: conversationID, "list.user": user.user },
                  {
                    $set: {
                      "list.$.buff.weed": false,
                      "list.$.buff.beer": true,
                      "list.$.inventory.beer": user.inventory.beer - 1,
                    },
                  }
                );
                await room.updateOne(
                  { room: conversationID, "list.user": owner.user },
                  {
                    $set: {
                      "list.$.buff.weed": false,
                      "list.$.buff.beer": true,
                    },
                  }
                );
                return ctx.reply(
                  `У каждого при себе 🍻\n🥴 ${owner.firstName} и ${user.firstName} нажрались`
                );
              }
              if (user.respect) {
                await room.updateOne(
                  { room: conversationID, "list.user": user.user },
                  {
                    $set: {
                      "list.$.respect": user.respect - 1,
                      "list.$.status": getStatus(
                        user.respect - 1,
                        user.report,
                        existUser
                      ),
                      "list.$.inventory.beer": user.inventory.beer + 1,
                    },
                  }
                );
                await room.updateOne(
                  { room: conversationID, "list.user": owner.user },
                  {
                    $set: {
                      "list.$.respect": owner.respect + 1,
                      "list.$.status": getStatus(
                        owner.respect + 1,
                        owner.report,
                        sender
                      ),
                    },
                  }
                );
                return ctx.reply(
                  `🤑 ${user.firstName} купил 🍻 у ${senderGen.first_name} за респект`
                );
              } else {
                if (user.buff.beer) {
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": false,
                        "list.$.report": user.report + 1,
                        "list.$.status": getStatus(
                          user.respect + 1,
                          user.report + 1,
                          existUser
                        ),
                      },
                    }
                  );
                  return ctx.reply(
                    `🥴 ${user.firstName} знатно набухался у ${senderGen.first_name}\n🤮 ${user.firstName} наблювал на хате 👎`
                  );
                } else {
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": true,
                      },
                    }
                  );
                  return ctx.reply(
                    `🥴 ${user.firstName} бесплатно напился у ${senderGen.first_name}`
                  );
                }
              }
            },
            async (existUser, user) => {
              if (existUser.buff.beer) {
                await room.updateOne(
                  { room: conversationID, "list.user": existUser.user },
                  {
                    $set: {
                      "list.$.report": existUser.report + 1,
                      "list.$.status": getStatus(
                        existUser.respect,
                        existUser.report + 1,
                        user
                      ),
                      "list.$.buff.weed": false,
                      "list.$.buff.beer": false,
                    },
                  }
                );
                return ctx.reply(
                  `🤢 ${existUser.firstName} перепил пива\n🤮 наблювал в беседе 👎`
                );
              } else {
                await room.updateOne(
                  { room: conversationID, "list.user": existUser.user },
                  {
                    $set: {
                      "list.$.buff.beer": true,
                      "list.$.buff.weed": false,
                    },
                  }
                );
                return ctx.reply(
                  `🍻 ${existUser.firstName} бахнул хорошего пивка\n🥴 В драке теперь будет чувствовать себя бодро`
                );
              }
            }
          );
        }
        if (payload.action === "throwWeed") {
          const spam = await antiSpam(ctx, 3);
          if (spam) return;
          await useLoot(
            "weed",
            "🌿",
            async (owner, user, existUser, sender, senderGen) => {
              if (!user) {
                return ctx.reply(
                  `😕 ${existUser.first_name} отказался от 🌿 стаффа ${senderGen.first_name}`
                );
              }
              if (user.inventory.weed) {
                if (owner.buff.weed && !user.buff.weed) {
                  await room.updateOne(
                    { room: conversationID, "list.user": owner.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": false,
                      },
                    }
                  );
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.buff.weed": true,
                        "list.$.buff.beer": false,
                        "list.$.inventory.weed": user.inventory.weed - 1,
                      },
                    }
                  );
                  return ctx.reply(
                    `У каждого при себе 🌿\n🤤 ${owner.firstName} и ${user.firstName} начали дуть\n${owner.firstName} перекурил и вырубился 😴 спать\n😟 снялись все бафы`
                  );
                }
                if (!owner.buff.weed && user.buff.weed) {
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": false,
                        "list.$.inventory.weed": user.inventory.weed - 1,
                      },
                    }
                  );
                  await room.updateOne(
                    { room: conversationID, "list.user": owner.user },
                    {
                      $set: {
                        "list.$.buff.weed": true,
                        "list.$.buff.beer": false,
                      },
                    }
                  );
                  return ctx.reply(
                    `У каждого при себе 🌿\n🤤 ${owner.firstName} и ${user.firstName} начали дуть\n${user.firstName} перекурил и вырубился 😴 спать\n😟 снялись все бафы`
                  );
                }
                if (owner.buff.weed === true && user.buff.weed === true) {
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": false,
                        "list.$.inventory.weed": user.inventory.weed - 1,
                      },
                    }
                  );
                  await room.updateOne(
                    { room: conversationID, "list.user": owner.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": false,
                      },
                    }
                  );
                  return ctx.reply(
                    `У каждого при себе 🌿\n🤤 ${owner.firstName} и ${user.firstName} начали дуть\nРебят сильно накумарило, и они вырубились 😴 спать\n😟 у них снялись все бафы`
                  );
                }
                await room.updateOne(
                  { room: conversationID, "list.user": user.user },
                  {
                    $set: {
                      "list.$.buff.weed": true,
                      "list.$.buff.beer": false,
                      "list.$.inventory.weed": user.inventory.weed - 1,
                    },
                  }
                );
                await room.updateOne(
                  { room: conversationID, "list.user": owner.user },
                  {
                    $set: {
                      "list.$.buff.weed": true,
                      "list.$.buff.beer": false,
                    },
                  }
                );
                return ctx.reply(
                  `У каждого при себе 🌿\n🤤 ${owner.firstName} и ${user.firstName} сладко дунули`
                );
              }

              if (user.respect) {
                await room.updateOne(
                  { room: conversationID, "list.user": user.user },
                  {
                    $set: {
                      "list.$.respect": user.respect - 1,
                      "list.$.status": getStatus(
                        user.respect - 1,
                        user.report,
                        existUser
                      ),
                      "list.$.inventory.weed": user.inventory.weed + 1,
                    },
                  }
                );
                await room.updateOne(
                  { room: conversationID, "list.user": owner.user },
                  {
                    $set: {
                      "list.$.respect": owner.respect + 1,
                      "list.$.status": getStatus(
                        owner.respect + 1,
                        owner.report,
                        sender
                      ),
                    },
                  }
                );
                return ctx.reply(
                  `🤑 ${user.firstName} купил 🌿 стафф у ${senderGen.first_name} за респект`
                );
              } else {
                if (user.buff.weed) {
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.buff.weed": false,
                        "list.$.buff.beer": false,
                      },
                    }
                  );
                  return ctx.reply(
                    `🥳 ${user.firstName} знатно подкурился у ${senderGen.first_name}\n${user.firstName} не выдержил, и вырубился 😴 спать\n😟 снялись все бафы`
                  );
                } else {
                  await room.updateOne(
                    { room: conversationID, "list.user": user.user },
                    {
                      $set: {
                        "list.$.buff.weed": true,
                        "list.$.buff.beer": false,
                      },
                    }
                  );
                  return ctx.reply(
                    `🥳 ${user.firstName} бесплатно подкурился у ${senderGen.first_name}`
                  );
                }
              }
            },
            async (existUser, user) => {
              if (existUser.buff.weed) {
                await room.updateOne(
                  { room: conversationID, "list.user": existUser.user },
                  {
                    $set: {
                      "list.$.buff.weed": false,
                      "list.$.buff.beer": false,
                    },
                  }
                );
                return ctx.reply(
                  `🤤 ${existUser.firstName} перекурил, и вырубился 😴 спать\n😟 снялись все бафы`
                );
              } else {
                await room.updateOne(
                  { room: conversationID, "list.user": existUser.user },
                  {
                    $set: {
                      "list.$.buff.beer": false,
                      "list.$.buff.weed": true,
                    },
                  }
                );
                return ctx.reply(
                  `😜 ${existUser.firstName} дунул хорошего 🌿 стаффа\n☀ принял растафарай`
                );
              }
            }
          );
        }
        // Русская рулетка ------------------------------------------------------------------
        if (payload.action === "takeRoulette") {
          try {
            const { profiles } = await bot.execute(
              "messages.getConversationMembers",
              {
                peer_id: ctx.message.peer_id,
              }
            );
            if (profiles.length === 1)
              return ctx.reply("☢ Игра доступна только для бесед!");

            let existRoom = await room.findOne({ room: conversationID });
            if (!existRoom) {
              await room.create({
                room: conversationID,
              });
              existRoom = await room.findOne({ room: conversationID });
            }
            const players = existRoom.roulette.players;
            const gameStarted = existRoom.roulette.gameStarted;
            const existPlayer = players.filter((el) => el.user == userID)[0];
            if (!existPlayer && gameStarted)
              return ctx.reply("🔫 Игроки играют, подожди...");
            const user = await getUser(userID);
            if (!existPlayer) {
              room
                .updateOne(
                  { room: conversationID },
                  {
                    $push: {
                      "roulette.players": {
                        user: userID,
                        bullet: 0,
                        shot: false,
                      },
                    },
                  }
                )
                .then(() => {
                  ctx.reply(
                    `🔫 ${
                      user.first_name
                    } вступил в игру! \n (онлайн — ${++players.length} чел.)`
                  );
                });
            } else {
              ctx.reply(`🔫 ${user.first_name}, ты уже взял револьвер!`);
            }
          } catch (err) {
            if (err.response.error_code === 917) {
              return ctx.reply("☢ Для игры, боту требуется админка!");
            }
            ctx.reply("☢ Блин блинский, сбой какой-то [takeRoulette]");
          }
        }
        if (payload.action === "rouletteRoll") {
          startRouletteGame(true);
        }
        if (payload.action === "rouletteShoot") {
          startRouletteGame(false, async (bullet) => {
            try {
              const genUser = await getUser(userID, "gen");
              const user = await getUser(userID);
              let currentRoom = await room.findOne({ room: conversationID });
              let currentBullet = currentRoom.roulette.bullet || 0;
              if (currentBullet === 0) {
                await room.updateOne(
                  { room: conversationID },
                  {
                    $set: {
                      "roulette.bullet": bullet,
                    },
                  }
                );
              }
              currentRoom = await room.findOne({ room: conversationID });
              currentBullet = currentRoom.roulette.bullet;
              const players = currentRoom.roulette.players;
              const currentPlayer = players.filter(
                (el) => el.user == userID
              )[0];

              if (currentPlayer.shot)
                return ctx.reply(
                  `🔫 ${user.first_name}, подождите других, не все успели стрельнуть!`
                );

              await room.updateOne(
                { room: conversationID, "roulette.players.user": userID },
                {
                  $set: {
                    "roulette.players.$.shot": true,
                  },
                }
              );

              currentRoom = await room.findOne({ room: conversationID });
              const notShotPlayers = currentRoom.roulette.players.filter(
                (el) => !el.shot
              );

              if (currentPlayer.bullet !== currentBullet) {
                ctx.reply(`🎰 ${genUser.first_name} пронесло...`);
                if (notShotPlayers.length === 0) {
                  await room.updateOne(
                    { room: conversationID },
                    {
                      $set: {
                        "roulette.bullet": 0,
                      },
                    }
                  );
                  currentRoom.roulette.players.forEach(async (player) => {
                    await room.updateOne(
                      {
                        room: conversationID,
                        "roulette.players.user": player.user,
                      },
                      {
                        $set: {
                          "roulette.players.$.shot": false,
                        },
                      }
                    );
                  });
                  ctx.reply(`🤵 Вам везёт, стреляйте еще раз!`);
                }
              } else {
                const arPlayersExceptCurrent = currentRoom.roulette.players.filter(
                  (el) => el.user != userID
                );
                await room.updateOne(
                  { room: conversationID },
                  {
                    $set: {
                      "roulette.players": arPlayersExceptCurrent,
                    },
                  }
                );
                currentRoom = await room.findOne({ room: conversationID });
                const notShotPlayers = currentRoom.roulette.players.filter(
                  (el) => !el.shot
                );

                ctx.reply(`${user.first_name} умер... ⚰ 😢😭`);

                if (notShotPlayers.length === 0) {
                  await room.updateOne(
                    { room: conversationID },
                    {
                      $set: {
                        "roulette.bullet": 0,
                      },
                    }
                  );
                  currentRoom.roulette.players.forEach(async (player) => {
                    await room.updateOne(
                      {
                        room: conversationID,
                        "roulette.players.user": player.user,
                      },
                      {
                        $set: {
                          "roulette.players.$.shot": false,
                        },
                      }
                    );
                  });
                }
                if (currentRoom.roulette.players.length === 1) {
                  const winner = currentRoom.roulette.players[0];
                  await room.updateOne(
                    { room: conversationID },
                    {
                      $set: {
                        roulette: {
                          gameStarted: false,
                          bullet: 0,
                          players: [],
                          top: [...currentRoom.roulette.top],
                        },
                      },
                    }
                  );
                  currentRoom = await room.findOne({ room: conversationID });
                  async function createTopList() {
                    await room.updateOne(
                      { room: conversationID },
                      {
                        $push: {
                          "roulette.top": {
                            user: winner.user,
                            score: 1,
                          },
                        },
                      }
                    );
                  }
                  if (currentRoom.roulette.top.length > 0) {
                    const existPlayerInTop = currentRoom.roulette.top.filter(
                      (player) => player.user === winner.user
                    )[0];
                    if (existPlayerInTop) {
                      await room.updateOne(
                        {
                          room: conversationID,
                          "roulette.top.user": winner.user,
                        },
                        {
                          $set: {
                            "roulette.top.$.score": existPlayerInTop.score + 1,
                          },
                        }
                      );
                    } else {
                      await createTopList();
                    }
                  } else {
                    await createTopList();
                  }
                  const user = await getUser(+winner.user);
                  ctx.reply(
                    `🏅 ${user.first_name} ${user.last_name} выходит из комнаты живым`
                  );
                }
              }
            } catch (err) {
              console.error(err);
              ctx.reply("☢ Блин блинский, сбой какой-то [rouletteShoot]");
            }
          });
        }
        if (payload.action === "rouletteTop") {
          const spam = await antiSpam(ctx, 3);
          if (spam) return;
          const currentRoom = await room.findOne({ room: conversationID });
          if (!currentRoom) return ctx.reply("📜 Список пуст...");
          const list = currentRoom.roulette.top;
          if (list.length < 1) return ctx.reply("📜 Список пуст...");
          const arTopPlayers = list.sort(compare);
          let topList = [];
          for (let player of arTopPlayers) {
            const user = await getUser(+player.user);
            topList.push({
              first_name: user.first_name,
              last_name: user.last_name,
              score: player.score,
            });
          }
          const formatedTopList = topList.map((player, idx) => {
            return `${idx + 1}. ${player.first_name} ${player.last_name} - ${
              player.score
            }\n`;
          });
          ctx.reply(`📜 Топ 🔫 русской рулетки\n${formatedTopList.join("")}`);
        }
        // 21 --------------------------------------------------------------------------------
        if (payload.action === "takeCards") {
          try {
            const rooms = JSON.parse(
              fs.readFileSync("./cards21.json", "utf-8")
            );
            const neededRoom = rooms.filter(
              (el) => el.room === conversationID
            )[0];
            let cardOne = arCards21[getRandomInt(0, arCards21.length)];
            let cardTwo = arCards21[getRandomInt(0, arCards21.length)];

            while (cardOne.name === "A" && cardTwo.name === "A") {
              cardOne = arCards21[getRandomInt(0, arCards21.length)];
              cardTwo = arCards21[getRandomInt(0, arCards21.length)];
            }

            if (!neededRoom) {
              rooms.push({
                room: conversationID,
                start: false,
                online: 1,
                players: [
                  {
                    user: userID,
                    cards: [`[${cardOne.name}]`, `[${cardTwo.name}]`],
                    score: cardOne.score + cardTwo.score,
                  },
                ],
                top: [],
              });
              await bot.sendMessage(
                userID,
                `-------\n[${cardOne.name}] [${cardTwo.name}]`
              );
              fs.writeFileSync(
                "./cards21.json",
                JSON.stringify(rooms, null, 2)
              );
            } else {
              const players = neededRoom.players;
              const existPlayer = players.filter((el) => el.user === userID)[0];
              if (existPlayer) {
                const user = await getUser(userID, "nom");
                return ctx.reply(
                  `🃏 ${user.first_name}, ты уже взял карты!`,
                  null,
                  Markup.keyboard([
                    Markup.button({
                      action: {
                        type: "text",
                        payload: JSON.stringify({
                          action: "showCards",
                        }),
                        label: "Показать карты",
                      },
                    }),
                  ]).inline()
                );
              }
              if (neededRoom.start)
                return ctx.reply("🃏 Игроки играют, подождите...");

              await bot.sendMessage(
                ctx.message.from_id,
                `-------\n[${cardOne.name}] [${cardTwo.name}]`
              );

              neededRoom.players.push({
                user: userID,
                cards: [`[${cardOne.name}]`, `[${cardTwo.name}]`],
                score: cardOne.score + cardTwo.score,
              });
              neededRoom.online += 1;
              const arDelRoom = rooms.filter(
                (el) => el.room !== conversationID
              );
              const newRooms = [neededRoom, ...arDelRoom];
              fs.writeFileSync(
                "./cards21.json",
                JSON.stringify(newRooms, null, 2)
              );
            }
          } catch (err) {
            console.error(err);
            bot.sendMessage(
              conversationID,
              `🃏 Напиши боту в лс (что угодно), и тогда сможешь брать карты`,
              null,
              Markup.keyboard([
                Markup.button({
                  action: {
                    type: "open_link",
                    link: "https://vk.com/im?media=&sel=-201031864",
                    label: "Написать",
                  },
                }),
              ]).inline()
            );
          }
        }
        if (payload.action === "takeCard") {
          try {
            const rooms = JSON.parse(
              fs.readFileSync("./cards21.json", "utf-8")
            );
            const neededRoom = rooms.filter(
              (el) => el.room === conversationID
            )[0];
            const user = await getUser(userID, "nom");

            let arPlayers = [];
            let existPlayer = null;

            if (neededRoom) {
              arPlayers = neededRoom.players;
              existPlayer = arPlayers.filter((el) => el.user === userID)[0];
            }
            if (!existPlayer) {
              return ctx.reply(
                `🃏 ${user.first_name}, ты не ${
                  user.sex === 2 ? "взял" : "взяла"
                } карты!`,
                null,
                Markup.keyboard([
                  Markup.button({
                    action: {
                      type: "text",
                      payload: JSON.stringify({
                        action: "takeCards",
                      }),
                      label: "Взять карты",
                    },
                  }),
                ]).inline()
              );
            }
            if (arPlayers.length < 2) {
              return ctx.reply(
                `🃏 Дождись хотя бы еще одного игрока, ему надо взять карты`
              );
            }
            if (existPlayer.score === 0) {
              return ctx.reply(
                `🃏 ${user.first_name}, ты лох, не можешь брать`
              );
            }

            const newCard = arCards21[getRandomInt(0, arCards21.length)];
            const scorePlayer = existPlayer.score + newCard.score;
            const cardsPlayer = [...existPlayer.cards, `[${newCard.name}]`];
            let updatePlayer = {
              user: userID,
              cards: cardsPlayer,
              score: scorePlayer,
            };
            const arDelPlayer = arPlayers.filter((el) => el.user !== userID);
            const arDelRoom = rooms.filter((el) => el.room !== conversationID);

            await bot.sendMessage(userID, `[${newCard.name}]`);

            neededRoom.start = true;

            if (scorePlayer > 21) {
              updatePlayer = {
                user: userID,
                cards: cardsPlayer,
                score: 0,
              };
              neededRoom.players = [updatePlayer, ...arDelPlayer];
              neededRoom.online -= 1;
              let newRooms = [neededRoom, ...arDelRoom];
              await bot.sendMessage(
                conversationID,
                `🃏 ${user.first_name} — лох, перебор ${scorePlayer}`
              );

              if (neededRoom.online < 1) {
                return await endGame21(neededRoom, arDelRoom);
              }

              fs.writeFileSync(
                "./cards21.json",
                JSON.stringify(newRooms, null, 2)
              );
            } else {
              neededRoom.players = [updatePlayer, ...arDelPlayer];
              let newRooms = [neededRoom, ...arDelRoom];
              fs.writeFileSync(
                "./cards21.json",
                JSON.stringify(newRooms, null, 2)
              );
            }
          } catch (err) {
            console.error(err);
            ctx.reply("&#9762; Блин блинский, сбой какой-то [takeCard]");
          }
        }
        if (payload.action === "giveTop") {
          const rooms = JSON.parse(fs.readFileSync("./cards21.json", "utf-8"));
          const neededRoom = rooms.filter(
            (el) => el.room === conversationID
          )[0];
          if (!neededRoom) {
            return ctx.reply(`📜 Список пуст...`);
          }
          const arTopPlayers = neededRoom.top.sort(compare);
          if (arTopPlayers.length < 1) {
            return ctx.reply(`📜 Список пуст...`);
          }
          const arTopPlayerList = arTopPlayers.map((el, idx) => {
            return `${idx + 1}. ${el.firstName} ${el.lastName} - ${el.score}\n`;
          });
          return ctx.reply(`📜 Топ челов в 🎯 21\n${arTopPlayerList.join("")}`);
        }
        if (payload.action === "showCards") {
          try {
            const rooms = JSON.parse(
              fs.readFileSync("./cards21.json", "utf-8")
            );
            const neededRoom = rooms.filter(
              (el) => el.room === conversationID
            )[0];
            const user = await getUser(userID, "nom");

            let arPlayers = [];
            let existPlayer = null;

            if (neededRoom) {
              arPlayers = neededRoom.players;
              existPlayer = arPlayers.filter((el) => el.user === userID)[0];
            }
            if (!existPlayer) {
              return ctx.reply(
                `🃏 ${user.first_name}, ты не ${
                  user.sex === 2 ? "взял" : "взяла"
                } карты!`,
                null,
                Markup.keyboard([
                  Markup.button({
                    action: {
                      type: "text",
                      payload: JSON.stringify({
                        action: "takeCards",
                      }),
                      label: "Взять карты",
                    },
                  }),
                ]).inline()
              );
            }
            if (arPlayers.length < 2) {
              return ctx.reply(
                `🃏 Дождись хотя бы еще одного игрока, ему надо взять карты`
              );
            }
            if (existPlayer.show) {
              return ctx.reply(
                `🃏 ${user.first_name}, ты уже показывал свои карты!`
              );
            }

            const cards = existPlayer.cards.join(" ");
            const arDelRoom = rooms.filter((el) => el.room !== conversationID);

            neededRoom.players.forEach((el) => {
              if (el.user === userID) {
                el.show = true;
                el.date = new Date();
              }
            });

            if (existPlayer.score === 0) {
              await bot.sendMessage(
                conversationID,
                `${user.first_name} ${
                  user.sex === 2 ? "проиграл" : "проиграла"
                } с такими картами ${cards}`
              );
              fs.writeFileSync(
                "./cards21.json",
                JSON.stringify([neededRoom[0], ...arDelRoom], null, 2)
              );
            } else if (existPlayer.score === 21) {
              const user = await getUser(userID, "gen");
              await bot.sendMessage(
                conversationID,
                `🃏 у ${user.first_name} ${cards}, ${
                  user.sex === 2 ? "набрал" : "набрала"
                } — ${existPlayer.score}`
              );
              return await endGame21(neededRoom, arDelRoom);
            } else {
              neededRoom.start = true;
              neededRoom.online -= 1;
              const user = await getUser(userID, "gen");
              await bot.sendMessage(
                conversationID,
                `🃏 у ${user.first_name} ${cards}, ${
                  user.sex === 2 ? "набрал" : "набрала"
                } — ${existPlayer.score}`
              );
              if (neededRoom.online < 1) {
                await endGame21(neededRoom, arDelRoom);
              } else {
                fs.writeFileSync(
                  "./cards21.json",
                  JSON.stringify([neededRoom, ...arDelRoom], null, 2)
                );
              }
            }
          } catch (err) {
            console.error(err);
            ctx.reply("&#9762; Блин блинский, сбой какой-то [showCards]");
          }
        }
        if (payload.action === "giveRule") {
          bot.sendMessage(
            ctx.message.peer_id,
            'Нажимая на кнопку \n"Взять карты", бот выдаст в лс твои карты,' +
              " твоя задача набрать наибольшую сумму очков среди участников (максимально 21)," +
              ' нажимая на кнопку "Взять еще", - бот выдаст одну карту в лс, если будет перебор,' +
              " ты автоматом будешь лохом. \nЕсли тебя устраивает сумма очков, нажми на кнопку" +
              ' "Показать карты"\n\nA - 11 очков\nK - 4\nQ - 3\nJ - 2\n10 - 10\n9 - 9\n8 - 8\n7 - 7\n6 - 6'
          );
        }
        if (payload.action === "showBtn") {
          showButtons21(conversationID);
        }
      }
    });
    //==========================================================================================
    bot.startPolling();
  } catch (err) {
    console.error(err);
  }
}
start();
