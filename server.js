const express = require("express");
const { v4: uuidv4 } = require("uuid");
const app = express();
const server = require("http").Server(app);
const io = require("socket.io")(server);
const fetch = require("node-fetch");
const dotenv = require("dotenv");
dotenv.config({ path: "./config.env" });

//Security middlewares
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

const port = process.env.PORT || 3030;

const whitelist = process.env.DEVELOPMENT_MODE
  ? ["https://associative-quiz.herokuapp.com", "http://localhost:3000"]
  : ["https://associative-quiz.herokuapp.com"];

const corsOptions = {
  origin: whitelist,
};

// app.use(
//   cors({
//     origin: function (origin, callback) {
//       // allow requests with no origin
//       // (like mobile apps or curl requests)
//       if (!origin) return callback(null, true);
//       if (whitelist.indexOf(origin) === -1) {
//         var msg =
//           "The CORS policy for this site does not " +
//           "allow access from the specified Origin.";
//         return callback(new Error(msg), false);
//       }
//       return callback(null, true);
//     },
//   })
// );

// middlewares
app.use(cors(corsOptions));

app.use(helmet());

const limiter = rateLimit({
  max: 30,
  windowMs: 30 * 60 * 1000,
  message: "Too many requests from this IP, please try again in an hour",
});
app.use("/api", limiter);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));

//API ROUTES

app.post("/api/v1/newSingleGame", async (req, res) => {
  const { area, level } = req.body;

  const data = await getQuizQuestions(area, level);

  res.status(200).json({ quizlist: data.quizlist, gameMode: "singlePlayer" });
});

app.get("/api/v1/getRoomID", (req, res) => {
  res.json(uuidv4());
});

// delete the memory of roomIds with game data
app.post("/api/v1/deleteGamesFromMemory", (req, res) => {
  const { secretPassword } = req.body;

  if (secretPassword === process.env.SECRET_PASSWORD) {
    games = {};
  }

  res.status(204)
})

let games = {};


// SOCKET CONNECTIONS

io.on("connection", (socket) => {
  socket.on("join-room", (roomId, username) => {
    //this connects the user to the room
    socket.join(roomId);
    // this just emit a new event: user-connected
    if (!games[roomId]) {
      games[roomId] = {};
      games[roomId].players = {};
      games[roomId].players[username] = {};
    } else {
      const usernames = Object.keys(games[roomId].players);
      if (!usernames.includes(username)) {
        games[roomId].players[username] = {};
      }
    }
    socket.to(roomId).broadcast.emit("user-connected", games[roomId].players);
  });

  socket.on("startGame", async (roomId, area, level, timeLimit) => {
    const data = await getQuizQuestions(area, level);
    //save the quiz details to roomId
    games[roomId].quiz = data.quizlist;
    games[roomId].createdAt = new Date();
    games[roomId].timeLimit = timeLimit;
    games[roomId].area = area;
    games[roomId].level = level;
    games[roomId].active = true;
    // before the game starts there is a 4sec countDown
    const timeLimitWithWaitingTime = timeLimit + 4;
    //send all the questions to the participants
    socket
      .to(roomId)
      .broadcast.emit(
        "quiz-list",
        data.quizlist,
        "multiPlayer",
        games[roomId].createdAt,
        games[roomId].timeLimit,
        games[roomId].area,
        games[roomId].level,
        timeLimitWithWaitingTime
      );
    setTimeout(() => {
      if (!games[roomId].everyoneFinished) {
        // if everyone finished the game, the results won't be sent after 1 min
        games[roomId].active = false;
        const formattedAnswers = rearrangeResultsObject(games[roomId].players);
        socket.to(roomId).broadcast.emit("quiz-finished", formattedAnswers);
      }
    }, timeLimitWithWaitingTime * 1000);
  });

  socket.on("submit-answers", (roomId, username, answers) => {
    if (!("answers" in games[roomId].players[username])) {
      games[roomId].players[username].answers = answers;
    }
    // check if everyone finished the quiz
    let everyoneFinished = true;

    Object.keys(games[roomId].players).forEach((username) => {
      if (!games[roomId].players[username].answers) {
        everyoneFinished = false;
      }
    });

    if (everyoneFinished) {
      games[roomId].everyoneFinished = true;
      games[roomId].active = false;
      const formattedAnswers = rearrangeResultsObject(games[roomId].players);
      socket.to(roomId).broadcast.emit("quiz-finished", formattedAnswers);
    }
  });

  socket.on("disconnect", () => {});
});

server.listen(port);

// FETCH DATA FROM RAPIDAPI
const getQuizQuestions = async (area, level) => {
  let API_URL;

  API_URL = process.env.API_URL.replace("<area>", area);

  API_URL = process.env.API_URL.replace("<level>", level);

  const response = await fetch(API_URL, {
    method: "GET",
    headers: {
      "x-rapidapi-host": process.env.X_RAPIDAPI_HOST,
      "x-rapidapi-key": process.env.X_RAPIDAPI_KEY,
    },
  });
  const data = await response.json();

  return data;
};

const rearrangeResultsObject = (result) => {
  /**
   * result: {
   *    username1: {
   *      answers: [num1, num2, num3, ... num10]
   *    },
   *    username2: { answers: [...]}
   * }
   */
  const answers = [];
  for (let i = 0; i < 10; i++) {
    const questionIndex = {};
    Object.entries(result).forEach(([key, value]) => {
      if (Object.keys(value).length) {
        questionIndex[key] = value.answers[i];
      }
    });
    answers.push(questionIndex);
  }
  // if nobody sent back the answers to the server then answers will be an Array of 10 empty objects
  return answers;
};
