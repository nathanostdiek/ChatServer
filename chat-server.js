// Require the packages we will use:
var http = require("http"),
	socketio = require("socket.io"),
    fs = require("fs")
    let password_dict = {};

    //room class to keep track of all the information that goes into a room
    class Room {
        constructor(name){
            this.name = name;
            this.admin = null;
            this.id = name;
            this.private = false;
            this.members = [];
            this.messages = [];
            this.banned = [];
            this.quarantined=false;
        }
    
        //makes the room private
        makePrivate(password){
            this.private=true;
            password_dict[this.name] = password;
        }
    
        //when a member joins add them to the member list
        addMember(user){
            this.members.push(user);
        }
        //when a member leaves remove them from the member list
        removeMember(user){
            this.members.splice(this.members.indexOf(user), 1);
        }

        //when a message is sent add it to the messages list
        addMessage(message){
            this.messages.push(message);

        }
    
        //keeps a list of all users who are banned from the room
        banUser(user){
            this.banned.push(user);
            this.removeMember(user);
        }
    }

    //class to keep track of individual messages
    class Message {
        constructor(content, user){
            this.content = content;
            this.user = user;
            let today = new Date();

            //format the timestamp because date objects dont like being passed around
            this.timestamp = (today.getMonth()+1)+"/"+today.getDate() + " " + today.getHours() + ":" + today.getMinutes();
            this.sentTo = "all";
            this.likes=0;
            this.liked_by=[];
        }
    
        setRecipient(user){
            this.sentTo = user;
        }

        //when a message gets liked add one to the like count and add the user to the "liked by" array
        like(user){
            this.likes++;
            this.liked_by.push(user.name);
        }

        //remove the like and the user from the liked array
        unlike(user){
            this.likes--;
            this.liked_by.splice(this.liked_by.indexOf(user.name), 1);
        }
    }

    //keeps track of the user
    class User {
        constructor(name){
            this.name  = name;
            this.banned = [];
            this.admin = [];
            this.loggedIn=false;
        }
    
        joinRoom(room_obj){
            this.rooms.push(room_obj);
            room_obj.addMember(this);
        }

        leaveRoom(room_obj){
            this.rooms.splice(this.rooms.indexOf(room_obj), 1);
        }
    
        gotBanned(room_obj){
            this.banned.push(room_obj);
            this.rooms.splice(this.rooms.indexOf(room_obj), 1);
        }
    }

//all the current rooms and all the current users
let all_rooms = [];
let all_users = [];

//since the rooms usually get passed by name from the client, this finds the object itself
function find_room(name){
    for(var i=0; i<all_rooms.length; i++){
        if(all_rooms[i].name == name){
            return all_rooms[i];
        }
    }
}

//same as the find room function, but for a user
function find_user(name){
    for(var i=0; i<all_users.length; i++){
        if(all_users[i].name==name){
            return all_users[i];
        }
    }
    return 0;
}

// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html:
var app = http.createServer(function(req, resp){
	// This callback runs when a new connection is made to our HTTP server.
	
	fs.readFile("client.html", function(err, data){
        // This callback runs when the client.html file has been read from the filesystem.
        
		if(err) return resp.writeHead(500);
		resp.writeHead(200);
		resp.end(data);
	});
});
app.listen(3456);

// Do the Socket.IO magic:
var io = socketio.listen(app);
io.sockets.on("connection", function(socket){
    // This callback runs when a new Socket.IO connection is established.

    //when a user logs in it decides if it will make a new account, or re-login a previous user
    socket.on('login', function(data) {
        let user = find_user(data['username']);
        let allow = false;
        if(!user){
            user = new User(String(data['username']));
            all_users.push(user);
            allow = true;
        }
        //io.sockets.emit("display-lobby", {message: all_rooms, a: allow});
        socket.emit("return_user", {user:user, a: allow});

        socket.emit("display-lobby", {message: all_rooms, a: allow});

    })

    //adds a message to the current room
	socket.on('message_sent', function(data) {
		// This callback runs when the server receives a new message from the client.
        let room = find_room(data['room']);
        let new_message = new Message(String(data['message']), data['user'])
        room.addMessage(new_message);
        let idx = room.messages.length-1; //need this to keep track of the messages
		io.in(data['room']).emit("display_message",{message:new_message, idx:idx}) // broadcast the message to other users in that room
    });
    
    //when a user joins a room display the messages in that room and update everyones user-list
    socket.on('joined-room', function(data){
        let room=find_room(data['room']);
        if(room.banned.indexOf(data.user.name)>-1){
            socket.emit("nice-try", {message: "You are banned from that room"});
        }
        else if(room.quarantined){
            socket.emit("nice-try", {message: "This room is quarantined"});
        }
        else{
            socket.join(data['room']);
            room.addMember(data['user']);
            socket.emit("populate-room", {messages:room.messages});
            io.in(data.room).emit('display_users_in_room', {users:room.members});
        }
    })

    //remove user from the user list and the room object
    socket.on('left-room', function(data){
        socket.leave(data['room'])
        let room = find_room(data.room);
        room.removeMember(data.user);
        socket.emit('clear-room', {clear:true});
        io.in(data.room).emit('display_users_in_room', {users:room.members});
    });

    //delete the room from the room object and kick everyone out who is currently in that room 
    socket.on('delete-room', function(data){
        let room = find_room(data.room);
        all_rooms.splice(all_rooms.indexOf(room), 1);
        io.in(data.room).emit("room-deleted", {room:room});
        io.sockets.emit("delete-room-to-client", {message:all_rooms});
    });

    //remove user from the room and add them to the banned user list
    socket.on("ban_user", function(data){
        let room = find_room(data.room);
        room.banUser(data.user);
        io.sockets.emit("user-banned", {banned_user: data.user});
    });

    //kick the user from the room, essentially redirect them to the main display but dont add them to the banned list
    socket.on("kick_user", function(data){
        let room = find_room(data.room);
        room.removeMember(data.user);
        io.sockets.emit("user-kicked", {kicked_user: data.user});
    })

    //if a message is liked, find the room and the message and increase its likes, then update everyones message display
    socket.on("like-message", function(data){
        let room = find_room(data.room);
        let message = room.messages[Number(data.msg_idx)];
        message.like(data.user);
        io.in(room.name).emit("populate-room", {messages:room.messages})
    });

    //same as liking, but remove the like
    socket.on("unlike-message", function(data){
        let room = find_room(data.room);
        let message = room.messages[Number(data.msg_idx)];
        message.unlike(data.user);
        io.in(room.name).emit("populate-room", {messages:room.messages})
    })

    //if a room is quarantined, set the variable and send it back to the client with a message
    socket.on("quarantine-room", function(data){
        let room = find_room(data.room);
        room.quarantined=true;
        io.sockets.emit('room-quarantined', {message: all_rooms});
        io.to(data.room).emit("you-are-quarantined", {message:"This chat room has been quarantined by the admin. No new users can join. If you leave the room you cannot return."});
    });

    //sends a private message to 
    socket.on("private-message", function(data){
        let a = find_room(data.r);
        let rec = find_user(data.to);
        let sender = find_user(data.from);
        let new_message = new Message(String(data.msg), sender);
        new_message.setRecipient(data.to);
        a.addMessage(new_message);

        io.in(a.name).emit("dm-message", {message: new_message, to: data.to, from: data.from, index: a.messages.length});
    });
    socket.on('create-room-to-server', function(data) {
        let room = new Room(String(data["name"]));
        let allow = true;
        for(let a = 0; a < all_rooms.length; a++){
            if(all_rooms[a].name == room.name){
                allow = false;
                break; 
            }
        }
        if(allow){
            room.admin = data["admin"];
            data["admin"].admin = data["name"];
            if(data["private"]){
                room.makePrivate(String(data["password"]));
                
            }
            all_rooms.push(room);
        }
        io.sockets.emit("create-room-to-client", {message: all_rooms, created: allow, r: room});

    });

    //this is for admin functionality. gets the list of users from the room asked for
    socket.on("get-user-list", function(data) {
        let room = find_room(data.room);
        let users = room.members;
        socket.emit("return-user-list", {room:room, users:users});
    });

    //try joining a private room
    socket.on("try-joining-room", function(data){
        let room = find_room(data['name']);

        if(room.banned.indexOf(data.user)>-1){
            socket.emit("nice-try", {message: "You are banned from that room"});
        }
        else if(room.quarantined){
            socket.emit("nice-try", {message: "This room is quarantined"});
        }
        else{
            let pass = password_dict[data['name']];
            socket.emit("try-joining-to-client", {allow: (pass == String(data['attemptedpass'])), r: room, user:data['user']});
        }
    });

    //returns all rooms, used to update the lobby display on return from a room
    socket.on('reload-rooms', function(data){
        socket.emit("display-lobby", {message: all_rooms, a: true});
    })

});


    
