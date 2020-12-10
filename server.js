//Nhập phụ thuộc
const path = require('path');
const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
//
const expressLayouts = require('express-ejs-layouts');
const passport = require('passport');
const flash = require('connect-flash');
const session = require('express-session');
//Import classes
const {LiveGames} = require('./utils/liveGames');
const {Players} = require('./utils/players');

const publicPath = path.join(__dirname, 'public');
var app = express();
var server = http.createServer(app);
var io = socketIO(server);
var games = new LiveGames();
var players = new Players();

//Mongodb setup
var MongoClient = require('mongodb').MongoClient;
var mongoose = require('mongoose');

app.use(express.static(publicPath));

require('./config/passport')(passport);

// DB Config
const db = require('./config/keys').mongoURI;

// Connect to MongoDB
mongoose
  .connect(
    db,
    { useNewUrlParser: true ,useUnifiedTopology: true}
  )
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

// EJS
app.use(expressLayouts);
app.set('view engine', 'ejs');

// Express body parser
app.use(express.urlencoded({ extended: true }));

// Express session
app.use(
  session({
    secret: 'secret',
    resave: true,
    saveUninitialized: true
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Connect flash
app.use(flash());

// Global variables
app.use(function(req, res, next) {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  next();
});

// Routes
app.use('/', require('./routes/index.js'));
app.use('/users', require('./routes/users.js'));

//Starting server on port 3000
server.listen(5000, () => {
    console.log("Server started on port 5000");
});

//Khi một kết nối đến máy chủ được thực hiện từ máy khách
io.on('connection', (socket) => {
    
    //Khi máy chủ kết nối lần đầu tiên
    socket.on('host-join', (data) =>{
        
        //Kiểm tra xem id được chuyển trong db có tương ứng với id của trò chơi kahoot trong cơ sở dữ liệu hay không
        MongoClient.connect(db, function(err, db) {
            if (err) throw err;
            var dbo = db.db("kahootDB");
            var query = { id:  parseInt(data.id)};
            dbo.collection('kahootGames').find(query).toArray(function(err, result){
                if(err) throw err;
                
                //Một kahoot đã được tìm thấy với id được chuyển trong db
                if(result[0] !== undefined){
                    var gamePin = Math.floor(Math.random()*90000) + 10000; //mã pin mới cho trò chơi

                    games.addGame(gamePin, socket.id, false, {playersAnswered: 0, questionLive: false, gameid: data.id, question: 1}); //Creates a game with pin and host id

                    var game = games.getGame(socket.id); //Nhan dữ liệu trò chơi

                    socket.join(game.pin);//Chủ nhà đang tham gia một phòng dựa trên mã pin

                    console.log('Game Created with pin:', game.pin); 

                    //Gửi mã ghim trò chơi đến máy chủ để họ có thể hiển thị cho người chơi tham gia
                    socket.emit('showGamePin', {
                        pin: game.pin
                    });
                }else{
                    socket.emit('noGameFound');
                }
                db.close();
            });
        });
        
    });
    
    //++Khi máy chủ kết nối từ chế độ xem trò chơi
    socket.on('host-join-game', (data) => {
        var oldHostId = data.id;
        var game = games.getGame(oldHostId);//Nhận trò chơi với id máy chủ cũ
        if(game){
            game.hostId = socket.id;//Thay đổi id máy chủ trò chơi thành id máy chủ mới
            socket.join(game.pin);
            var playerData = players.getPlayers(oldHostId);//Đưa người chơi vào trò chơi
            for(var i = 0; i < Object.keys(players.players).length; i++){
                if(players.players[i].hostId == oldHostId){
                    players.players[i].hostId = socket.id;
                }
            }
            var gameid = game.gameData['gameid'];
            MongoClient.connect(db, function(err, db){
                if (err) throw err;
    
                var dbo = db.db('kahootDB');
                var query = { id:  parseInt(gameid)};
                dbo.collection("kahootGames").find(query).toArray(function(err, res) {
                    if (err) throw err;
                    var sizequestion = res[0].questions;
                    var question = res[0].questions[0].question;
                    var answer1 = res[0].questions[0].answers[0];
                    var answer2 = res[0].questions[0].answers[1];
                    var answer3 = res[0].questions[0].answers[2];
                    var answer4 = res[0].questions[0].answers[3];
                    var correctAnswer = res[0].questions[0].correct;
                    // ++
                    var timeAnswer = res[0].questions[0].time;
                    var poinAnswer = res[0].questions[0].poin;
                    

                    
                    socket.emit('gameQuestions', {
                        q1: question,
                        a1: answer1,
                        a2: answer2,
                        a3: answer3,
                        a4: answer4,
                        correct: correctAnswer,
                        // ++
                        size1: sizequestion,
                        time: timeAnswer,
                        poin: poinAnswer,
                        playersInGame: playerData.length
                    });
                    db.close();
                });
            });
            
            
            io.to(game.pin).emit('gameStartedPlayer');
            game.gameData.questionLive = true;
        }else{
            socket.emit('noGameFound');//Không tìm thấy trò chơi nào, chuyển hướng người dùng
        }
    });


    ///

    socket.on('edit-game', (data) => {
            var gameid = data;
            MongoClient.connect(db, function(err, db){
                if (err) throw err;
    
                var dbo = db.db('kahootDB');
                var query = { id: parseInt(gameid)};
                var array = [];
                dbo.collection("kahootGames").find(query).toArray(function(err, res) {
                    if (err) throw err;
                    var iduser = res[0].id_user;
                    var idq = res[0].id;
                    var sizequestion = res[0].questions.length;
                    var name = res[0].name;
                    for(var i=0;i<sizequestion;i++){
                    array[0+i*10] = res[0].questions[i].question;
                    array[1+i*10] = res[0].questions[i].answers[0];
                    array[2+i*10] = res[0].questions[i].answers[1];
                    array[3+i*10] = res[0].questions[i].answers[2];
                    array[4+i*10] = res[0].questions[i].answers[3];
                    array[5+i*10] = res[0].questions[i].correct;
                    // ++
                    array[6+i*10] = res[0].questions[i].time;
                    array[7+i*10] = res[0].questions[i].poin;
                    
                    }
                    
                    socket.emit('editQuestions', {
                        q1: array,
                        size1: sizequestion,
                        name: name,
                        userid1: iduser,
                        idq1: idq
                    });
                    db.close();
                });
            });
            
    });

    ///
    
    //Khi người chơi kết nối lần đầu tiên
    socket.on('player-join', (params) => {
        
        var gameFound = false; //Nếu một trò chơi được tìm thấy với mã pin do người chơi cung cấp
        
        //Đối với mỗi trò chơi trong hạng Trò chơi
        for(var i = 0; i < games.games.length; i++){
            //Nếu chốt bằng một trong các chốt của trò chơi
            if(params.pin == games.games[i].pin){
                
                console.log('Player connected to game');
                
                var hostId = games.games[i].hostId; // Nhận id của máy chủ của trò chơi
                
                
                players.addPlayer(hostId, socket.id, params.name, {score: 0, answer: 0}); //thêm người chơi vào trò chơi
                
                socket.join(params.pin); //Người chơi đang tham gia phòng dựa trên mã pin
                
                var playersInGame = players.getPlayers(hostId); //Thu hút tất cả người chơi trong trò chơi
                
                io.to(params.pin).emit('updatePlayerLobby', playersInGame);//Gửi dữ liệu trình phát máy chủ để hiển thị
                gameFound = true; //Trò chơi đã được tìm thấy
            }
        }
        
        //Nếu trò chơi chưa được tìm thấy
        if(gameFound == false){
            socket.emit('noGameFound'); //Người chơi được đưa trở lại trang 'tham gia' vì không tìm thấy trò chơi với mã pin
        }
        
        
    });
    
//Khi người chơi kết nối từ chế độ xem trò chơi
    socket.on('player-join-game', (data) => {
        var player = players.getPlayer(data.id);
        if(player){
            var game = games.getGame(player.hostId);
            socket.join(game.pin);
            player.playerId = socket.id;//Cập nhật id trình phát với id socket
            
            var playerData = players.getPlayers(game.hostId);
            socket.emit('playerGameData', playerData);
        }else{
            socket.emit('noGameFound');//Không tìm thấy người chơi`
        }
        
    });
    
    //--Khi máy chủ hoặc người chơi rời khỏi trang web
    socket.on('disconnect', () => {
        var game = games.getGame(socket.id); //Tìm trò chơi với socket.id
        //Nếu một trò chơi được lưu trữ bởi id đó được tìm thấy, ổ cắm bị ngắt kết nối là một máy chủ
        if(game){
            //Kiểm tra xem máy chủ có bị ngắt kết nối hoặc được chuyển đến chế độ xem trò chơi hay không
            if(game.gameLive == false){
                games.removeGame(socket.id);//Xóa trò chơi khỏi lớp trò chơi
                console.log('Game ended with pin:', game.pin);

                var playersToRemove = players.getPlayers(game.hostId); //Thu hút tất cả người chơi trong trò chơi

                //Đối với mỗi người chơi trong trò chơi
                for(var i = 0; i < playersToRemove.length; i++){
                    players.removePlayer(playersToRemove[i].playerId); //Xóa từng người chơi khỏi lớp người chơi
                }

                io.to(game.pin).emit('hostDisconnect'); //Đưa người chơi trở lại màn hình 'join'
                socket.leave(game.pin); //Socket đang rời khỏi phòng
            }
        }else{
            //Không có trò chơi nào được tìm thấy, vì vậy đó là ổ cắm máy nghe nhạc đã bị ngắt kết nối
            var player = players.getPlayer(socket.id); //Bắt đầu phát với socket.id
            //Nếu một người chơi được tìm thấy với id đó
            if(player){
                var hostId = player.hostId;//Nhận id của máy chủ của trò chơi
                var game = games.getGame(hostId);//Nhận dữ liệu trò chơi với hostId
                var pin = game.pin;//Nhận được ghim của trò chơi
                
                if(game.gameLive == false){
                    players.removePlayer(socket.id);//Xóa người chơi khỏi lớp người chơi
                    var playersInGame = players.getPlayers(hostId);//Thu hút những người chơi còn lại trong trò chơi

                    io.to(pin).emit('updatePlayerLobby', playersInGame);//Gửi dữ liệu đến máy chủ lưu trữ để cập nhật màn hình
                    socket.leave(pin); //Người chơi đang rời khỏi phòng
            
                }
            }
        }
        
    });
    var randomso = 0
    //++Đặt dữ liệu trong lớp người chơi để trả lời từ người chơi
    socket.on('playerAnswer', function(num){
        var player = players.getPlayer(socket.id);
        var hostId = player.hostId;
        var playerNum = players.getPlayers(hostId);
        var game = games.getGame(hostId);
        if(game.gameData.questionLive == true){//nếu câu hỏi vẫn còn sống
            player.gameData.answer = num;
            game.gameData.playersAnswered += 1;
            
            var gameQuestion = game.gameData.question;
            var gameid = game.gameData.gameid;
            
            MongoClient.connect(db, function(err, db){
                if (err) throw err;
    
                var dbo = db.db('kahootDB');
                var query = { id:  parseInt(gameid)};
                dbo.collection("kahootGames").find(query).toArray(function(err, res) {
                    if (err) throw err;
                    var correctAnswer = res[0].questions[gameQuestion - 1].correct;
                    var poinAnswer = res[0].questions[gameQuestion - 1].poin;
                    
                    //Kiểm tra câu trả lời của người chơi với câu trả lời đúng
                    if(num == correctAnswer){
                        player.gameData.score += Number(poinAnswer);
                        io.to(game.pin).emit('getTime', socket.id);
                        socket.emit('answerResult', true);
                    }

                    //Kiểm tra xem tất cả người chơi có trả lời hay không
                    if(game.gameData.playersAnswered == playerNum.length){
                        game.gameData.questionLive = false; //Câu hỏi đã được kết thúc người chơi bc tất cả đều trả lời
                        var playerData = players.getPlayers(game.hostId);
                        io.to(game.pin).emit('questionOver', playerData, correctAnswer);//Nói với mọi người rằng câu hỏi đã kết thúc
                    }else{
                        //cập nhật màn hình máy chủ của số người chơi đã trả lời
                        io.to(game.pin).emit('updatePlayersAnswered', {
                            playersInGame: playerNum.length,
                            playersAnswered: game.gameData.playersAnswered
                        });
                    }
                    
                    db.close();
                });
            });
            
            
            
        }
    });
    // +++
    socket.on('getScore', function(){
        var player = players.getPlayer(socket.id);
        socket.emit('newScore', player.gameData.score); 
    });
    // +++
    socket.on('time', function(data){
        var time = data.time;
        var time_answer = Number(data.time_answer);
        if(time >= 0.8*time_answer){
            time = 1;                                                                           
        }
        else if(time >= 0.5*time_answer){
            time = 0.8;
        }
        else time = 0.5;
        var playerid = data.player;
        var player = players.getPlayer(playerid);
        player.gameData.score *= time;
    });
    
    
    
    socket.on('timeUp', function(){
        var game = games.getGame(socket.id);
        game.gameData.questionLive = false;
        var playerData = players.getPlayers(game.hostId);
        
        var gameQuestion = game.gameData.question;
        var gameid = game.gameData.gameid;
            
            MongoClient.connect(db, function(err, db){
                if (err) throw err;
    
                var dbo = db.db('kahootDB');
                var query = { id:  parseInt(gameid)};
                dbo.collection("kahootGames").find(query).toArray(function(err, res) {
                    if (err) throw err;
                    var correctAnswer = res[0].questions[gameQuestion - 1].correct;
                    io.to(game.pin).emit('questionOver', playerData, correctAnswer);
                    
                    db.close();
                });
            });
    });
    
    socket.on('nextQuestion', function(){
        var playerData = players.getPlayers(socket.id);
        //Đặt lại câu trả lời hiện tại của người chơi thành 0
        for(var i = 0; i < Object.keys(players.players).length; i++){
            if(players.players[i].hostId == socket.id){
                players.players[i].gameData.answer = 0;
            }
        }
        
        var game = games.getGame(socket.id);
        game.gameData.playersAnswered = 0;
        game.gameData.questionLive = true;
        game.gameData.question += 1;
        var gameid = game.gameData.gameid;
        
        
        // ++
        MongoClient.connect(db, function(err, db){
                if (err) throw err;
    
                var dbo = db.db('kahootDB');
                var query = { id:  parseInt(gameid)};
                dbo.collection("kahootGames").find(query).toArray(function(err, res) {
                    if (err) throw err;
                    
                    if(res[0].questions.length >= game.gameData.question){
                        var questionNum = game.gameData.question;
                        questionNum = questionNum - 1;
                        var question = res[0].questions[questionNum].question;
                        var answer1 = res[0].questions[questionNum].answers[0];
                        var answer2 = res[0].questions[questionNum].answers[1];
                        var answer3 = res[0].questions[questionNum].answers[2];
                        var answer4 = res[0].questions[questionNum].answers[3];
                        var correctAnswer = res[0].questions[questionNum].correct;
                        // ++
                        var timeAnswer = res[0].questions[questionNum].time;
                        var poinAnswer = res[0].questions[questionNum].poin;


                        socket.emit('gameQuestions', {
                            q1: question,
                            a1: answer1,
                            a2: answer2,
                            a3: answer3,
                            a4: answer4,
                            correct: correctAnswer,
                            // ++
                            time: timeAnswer,
                            poin: poinAnswer,
                            playersInGame: playerData.length
                        });
                        db.close();
                    }else{
                        var playersInGame = players.getPlayers(game.hostId);
                        var first = {name: "", score: 0};
                        var second = {name: "", score: 0};
                        var third = {name: "", score: 0};
                        var fourth = {name: "", score: 0};
                        var fifth = {name: "", score: 0};
                        
                        for(var i = 0; i < playersInGame.length; i++){
                            console.log(playersInGame[i].gameData.score);
                            if(playersInGame[i].gameData.score > fifth.score){
                                if(playersInGame[i].gameData.score > fourth.score){
                                    if(playersInGame[i].gameData.score > third.score){
                                        if(playersInGame[i].gameData.score > second.score){
                                            if(playersInGame[i].gameData.score > first.score){
                                                //Địa điểm đầu tiên
                                                fifth.name = fourth.name;
                                                fifth.score = fourth.score;
                                                
                                                fourth.name = third.name;
                                                fourth.score = third.score;
                                                
                                                third.name = second.name;
                                                third.score = second.score;
                                                
                                                second.name = first.name;
                                                second.score = first.score;
                                                
                                                first.name = playersInGame[i].name;
                                                first.score = playersInGame[i].gameData.score;
                                            }else{
                                                //Nơi thứ hai
                                                fifth.name = fourth.name;
                                                fifth.score = fourth.score;
                                                
                                                fourth.name = third.name;
                                                fourth.score = third.score;
                                                
                                                third.name = second.name;
                                                third.score = second.score;
                                                
                                                second.name = playersInGame[i].name;
                                                second.score = playersInGame[i].gameData.score;
                                            }
                                        }else{
                                            //Vị trí thứ ba
                                            fifth.name = fourth.name;
                                            fifth.score = fourth.score;
                                                
                                            fourth.name = third.name;
                                            fourth.score = third.score;
                                            
                                            third.name = playersInGame[i].name;
                                            third.score = playersInGame[i].gameData.score;
                                        }
                                    }else{
                                        //Vị trí thứ tư
                                        fifth.name = fourth.name;
                                        fifth.score = fourth.score;
                                        
                                        fourth.name = playersInGame[i].name;
                                        fourth.score = playersInGame[i].gameData.score;
                                    }
                                }else{
                                    //Vị trí thứ năm
                                    fifth.name = playersInGame[i].name;
                                    fifth.score = playersInGame[i].gameData.score;
                                }
                            }
                        }
                    
                        io.to(game.pin).emit('GameOver', {
                            num1: first.name,
                            num2: second.name,
                            num3: third.name,
                            num4: fourth.name,
                            num5: fifth.name
                        });
                    }
                });
            });
        
        io.to(game.pin).emit('nextQuestionPlayer');
    });
    
    //
    socket.on('showGame', function(){
        var playerData = players.getPlayers(socket.id);
        var game = games.getGame(socket.id);
        var playersInGame = players.getPlayers(game.hostId);
        var first = {name: "", score: 0};
        var second = {name: "", score: 0};
        var third = {name: "", score: 0};
        var fourth = {name: "", score: 0};
        var fifth = {name: "", score: 0};
                        
        for(var i = 0; i < playersInGame.length; i++){
            console.log(playersInGame[i].gameData.score);
            if(playersInGame[i].gameData.score > fifth.score){
                if(playersInGame[i].gameData.score > fourth.score){
                    if(playersInGame[i].gameData.score > third.score){
                        if(playersInGame[i].gameData.score > second.score){
                            if(playersInGame[i].gameData.score > first.score){
                                //Địa điểm đầu tiên
                                fifth.name = fourth.name;
                                fifth.score = fourth.score;
                                
                                fourth.name = third.name;
                                fourth.score = third.score;
                                
                                third.name = second.name;
                                third.score = second.score;
                                
                                second.name = first.name;
                                second.score = first.score;
                                
                                first.name = playersInGame[i].name;
                                first.score = playersInGame[i].gameData.score;
                            }else{
                                //Nơi thứ hai
                                fifth.name = fourth.name;
                                fifth.score = fourth.score;
                                
                                fourth.name = third.name;
                                fourth.score = third.score;
                                
                                third.name = second.name;
                                third.score = second.score;
                                
                                second.name = playersInGame[i].name;
                                second.score = playersInGame[i].gameData.score;
                            }
                        }else{
                            //Vị trí thứ ba
                            fifth.name = fourth.name;
                            fifth.score = fourth.score;
                                
                            fourth.name = third.name;
                            fourth.score = third.score;
                            
                            third.name = playersInGame[i].name;
                            third.score = playersInGame[i].gameData.score;
                        }
                    }else{
                        //Vị trí thứ tư
                        fifth.name = fourth.name;
                        fifth.score = fourth.score;
                        
                        fourth.name = playersInGame[i].name;
                        fourth.score = playersInGame[i].gameData.score;
                    }
                }else{
                    //Vị trí thứ năm
                    fifth.name = playersInGame[i].name;
                    fifth.score = playersInGame[i].gameData.score;
                }
            }
        }
        io.to(game.pin).emit('showList', {
            name1: first.name,
            name2: second.name,
            name3: third.name,
            name4: fourth.name,
            name5: fifth.name, 
            poin1: first.score,
            poin2: second.score,
            poin3: third.score,
            poin4: fourth.score,
            poin5: fifth.score
        });
    });

    //
    //Khi người dẫn chương trình bắt đầu trò chơi
    socket.on('startGame', () => {
        var game = games.getGame(socket.id);//Tải trò chơi dựa trên socket.id
        game.gameLive = true;
        socket.emit('gameStarted', game.hostId);//Nói với người chơi và máy chủ rằng trò chơi đã bắt đầu
    });
    
    //Cung cấp dữ liệu tên trò chơi của người dùng
    socket.on('requestDbNames', function(){
        
        MongoClient.connect(db, function(err, db){
            if (err) throw err;
    
            var dbo = db.db('kahootDB');
            dbo.collection("kahootGames").find().toArray(function(err, res) {
                if (err) throw err;
                socket.emit('gameNamesData', res);
                db.close();
            });
        });
        
    });
    
    // ++
    socket.on('deleteQuiz', function(data){
        MongoClient.connect(db, function(err, db){
            if (err) throw err;
            var dbo = db.db('kahootDB');
            var dele = dbo.collection('kahootGames');
            dele.deleteOne(data, function (err,res) {
                if (err) throw err;
                console.log('delete success: ' + res.result.n +' record');
            });

        });
            
    });

    socket.on('newQuiz', function(data){
        MongoClient.connect(db, function(err, db){
            if (err) throw err;
            var dbo = db.db('kahootDB');
            dbo.collection('kahootGames').find({}).toArray(function(err, result){
                if(err) throw err;
                var num = Object.keys(result).length;
                if(num == 0){
                	data.id = 1
                	num = 1
                }else{
                	data.id = result[num -1 ].id + 1;
                }
                var game = data;
                dbo.collection("kahootGames").insertOne(game, function(err, res) {
                    if (err) throw err;
                    db.close();
                });
                db.close();
                socket.emit('startGameFromCreator', num);
            });
            
        });
        
        
    });
    
});
