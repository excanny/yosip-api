const ensureGuestSession = (req, res, next) => {
  // If user is logged in, skip session creation
  if (req.body.userId) {
    return next();
  }

  // Check if session exists in cookie (with safety check)
  let sessionId = req.cookies?.guestSessionId; // Added optional chaining

  if (!sessionId) {
    // Generate new session ID only
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Set cookie with session ID (30 days expiry)
    res.cookie('guestSessionId', sessionId, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
  }

  // Attach session ID to request
  req.sessionId = sessionId;
  next();
};

export default ensureGuestSession;