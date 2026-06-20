import app from "./app.js";
import db from "./db/client.js";

const PORT = 3000;
db.connect();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});