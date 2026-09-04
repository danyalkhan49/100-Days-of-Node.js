const express = require("express");
const app = express();

const rooms = {
  R101: { type: "Single", pricePerNight: 2000, isBooked: false },
  R102: { type: "Double", pricePerNight: 3500, isBooked: false },
  R103: { type: "Suite", pricePerNight: 6000, isBooked: true }
};

const guests = {
  G1: { name: "Danial", bookings: [] },
  G2: { name: "Ali", bookings: [] }
};

function checkRoom(req, res, next) {
  const roomId = req.params.roomId;
  if (!rooms[roomId]) {
    return res.status(404).json({
      success: false,
      error: "Room not found"
    });
  }

  req.room = rooms[roomId];
  next();
}

function checkGuest(req, res, next) {
  const guestId = req.params.guestId;
  if (!guests[guestId]) {
    return res.status(404).json({
      success: false,
      error: "Guest not found"
    });
  }

  req.guest = guests[guestId];
  next();
}

app.get("/rooms", (req, res) => {
  let result = Object.values(rooms);

  if (req.query.type) {
    result = result.filter(room => room.type === req.query.type);
  }

  if (req.query.availableOnly === "true") {
    result = result.filter(room => room.isBooked === false);
  }

  res.status(200).json(result);
});

app.get("/book/:roomId/:guestId/:nights", checkRoom, checkGuest, (req, res) => {
  try {
    const roomId = req.params.roomId;
    const guestId = req.params.guestId;
    const nights = Number(req.params.nights);

    const room = rooms[roomId];
    const guest = guests[guestId];

    if (room.isBooked === true) {
      return res.status(409).json({
        message: "The room is already booked"
      });
    }

    if (!Number.isFinite(nights) || nights <= 0) {
      return res.status(409).json({
        message: "Invalid number of nights"
      });
    }

    let totalCost = room.pricePerNight * nights;
    if (nights >= 7) {
      totalCost = totalCost * 0.85;
    }

    room.isBooked = true;
    guest.bookings.push({
      roomId,
      guestId,
      date: new Date(),
      totalCost
    });

    return res.status(200).json({
      success: true,
      message: "Booking successful",
      booking: {
        roomId,
        guestId,
        nights,
        totalCost
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
});

app.get('/cancel/:roomId/:guestId' , checkRoom , checkGuest , (req , res) =>{
    try{
        const room = req.room;
        const guest = req.guest;
        const roomId = number(req.params.roomId);
        const bookingIndex = guest.bookings.findIndex(
        booking => booking.roomId === roomId
      );
      if(bookingIndex !== -1){
         return res.status(400).json({
          message: "This guest has no booking for this room"
        });
      }
      isBooked = false ;

      guest.bookings.splice(bookingIndex, 1);

      res.status(200).json({
        message: "Booking cancelled successfully"
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Something went wrong",
        error: error.message
      });
    }
  }
);


app.get("/guest/:guestId/bookings", checkGuest, (req, res) => {
  try {
    const guest = req.guest;

    const bookings = guest.bookings.map(booking => {
      const room = rooms.find(
        room => room.id === booking.roomId
      );

      return {
        roomId: booking.roomId,
        roomType: room ? room.type : "Unknown",
        nights: booking.nights,
        totalCost: booking.totalCost,
        bookedOn: booking.bookedOn
      };
    });

    res.status(200).json(bookings);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
});


const checkAdmin = (req, res, next) => {
  try {
    const key = req.query.key;

    if (key !== "hotel123") {
      return res.status(403).json({
        message: "Access Denied"
      });
    }

    next();

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
};



app.get("/admin/revenue", checkAdmin, (req, res) => {
  try {
    let totalRevenue = 0;

    // Calculate total revenue
    guests.forEach(guest => {
      guest.bookings.forEach(booking => {
        totalRevenue += booking.totalCost;
      });
    });

    // Calculate booked and available rooms
    const totalRoomsBooked = rooms.filter(
      room => room.isBooked === true
    ).length;

    const totalRoomsAvailable = rooms.filter(
      room => room.isBooked === false
    ).length;

    res.status(200).json({
      totalRevenue: totalRevenue,
      totalRoomsBooked: totalRoomsBooked,
      totalRoomsAvailable: totalRoomsAvailable
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
});








app.use((req, res) => {
  const time = new Date();
  const url = req.originalUrl;
  res.status(404).send(`Time: ${time.toLocaleString()} and location is: ${url}`);
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});