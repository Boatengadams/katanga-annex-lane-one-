exports.notifyAdmin = functions.firestore
  .document("reports/{id}")
  .onCreate(async () => {
    const payload = {
      notification: {
        title: "New Fault Report",
        body: "A new fault has been reported"
      }
    };
    return sendToAdmins(payload);
  });
