const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dns = require('dns');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

dns.setServers(['8.8.8.8', '8.8.4.4']);

const app = express();
app.use(express.json());
app.use(cors());

// Ensure uploads folder exists in current directory
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// Configure Multer Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const JWT_SECRET = "super_secret_social_platform_key_123";
const MONGO_URI = "mongodb+srv://osctokceo:acu8aww112@cluster0.0ifdvao.mongodb.net/social_app?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected successfully to MongoDB Atlas!'))
  .catch((err) => console.error('❌ Database connection error:', err));

// --- SCHEMAS ---

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  displayName: { type: String, required: true },
  avatarUrl: { type: String, default: "https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png" },
  bio: { type: String, default: "" },
  followers: { type: [String], default: [] },
  following: { type: [String], default: [] },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

const PostSchema = new mongoose.Schema({
  author: String,
  handle: String,
  avatarUrl: String,
  isVerified: Boolean,
  postType: { type: String, enum: ['post', 'blog', 'video', 'audio'], default: 'post' },
  title: { type: String, default: "" },
  content: String,
  mediaUrl: { type: String, default: "" },
  likes: { type: Number, default: 0 },
  likedBy: { type: [String], default: [] }
}, { timestamps: true });

const Post = mongoose.model('Post', PostSchema);

const CommentSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  author: String,
  handle: String,
  avatarUrl: String,
  content: String
}, { timestamps: true });

const Comment = mongoose.model('Comment', CommentSchema);

// --- FILE UPLOAD ROUTE WITH ERROR HANDLING ---

app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error("❌ Multer upload error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file provided" });
    }

    const fileUrl = `http://localhost:3000/uploads/${req.file.filename}`;
    console.log(`✅ File uploaded successfully: ${req.file.filename}`);
    res.json({ success: true, fileUrl, fileType: req.file.mimetype });
  });
});

// --- AUTH & USER ROUTES ---

app.post('/api/auth/signup', async (req, res) => {
  try {
    let { username, password, displayName } = req.body;
    if (!username || !password || !displayName) return res.status(400).json({ error: "All fields are required" });

    if (!username.startsWith('@')) username = `@${username}`;

    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: "Handle already taken!" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword, displayName, followers: [], following: [] });

    await newUser.save();
    res.json({ success: true, message: "Account created!" });
  } catch (err) {
    res.status(500).json({ error: "Sign up failed." });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    let { username, password } = req.body;
    if (!username.startsWith('@')) username = `@${username}`;

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });
    if (user.isBanned) return res.status(403).json({ error: "This account has been banned." });

    let isMatch = false;
    if (user.password.startsWith('$2b$') || user.password.startsWith('$2a$')) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = (password === user.password);
      if (isMatch) {
        user.password = await bcrypt.hash(password, 10);
        await user.save();
      }
    }

    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio || "",
        followers: user.followers || [],
        following: user.following || [],
        isVerified: user.isVerified || false
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Login failed." });
  }
});

app.post('/api/user/profile', async (req, res) => {
  try {
    const { handle, avatarUrl, bio } = req.body;
    const user = await User.findOneAndUpdate(
      { username: handle },
      { $set: { avatarUrl, bio } },
      { new: true }
    );
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

app.post('/api/user/follow', async (req, res) => {
  try {
    const { currentHandle, targetHandle } = req.body;
    if (currentHandle === targetHandle) return res.status(400).json({ error: "Cannot follow yourself" });

    const currentUser = await User.findOne({ username: currentHandle });
    if (!currentUser) return res.status(404).json({ error: "User not found" });

    const following = currentUser.following || [];
    const isFollowing = following.includes(targetHandle);

    if (isFollowing) {
      await User.updateOne({ username: currentHandle }, { $pull: { following: targetHandle } });
      await User.updateOne({ username: targetHandle }, { $pull: { followers: currentHandle } });
    } else {
      await User.updateOne({ username: currentHandle }, { $addToSet: { following: targetHandle } });
      await User.updateOne({ username: targetHandle }, { $addToSet: { followers: currentHandle } });
    }

    const updatedUser = await User.findOne({ username: currentHandle });
    res.json({ success: true, following: updatedUser.following || [] });
  } catch (err) {
    res.status(500).json({ error: "Follow action failed" });
  }
});

// --- POSTS & COMMENTS ROUTES ---

app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

app.post('/api/posts', async (req, res) => {
  try {
    const { author, handle, content, mediaUrl, postType, title } = req.body;
    const user = await User.findOne({ username: handle });

    if (user && user.isBanned) return res.status(403).json({ error: "Banned users cannot post." });

    const newPost = new Post({
      author: author || "User",
      handle: handle || "@guest",
      avatarUrl: user ? user.avatarUrl : "https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png",
      isVerified: user ? user.isVerified : false,
      postType: postType || 'post',
      title: title || "",
      content,
      mediaUrl: mediaUrl || ""
    });

    await newPost.save();
    res.json({ success: true, post: newPost });
  } catch (err) {
    res.status(500).json({ error: "Failed to create post" });
  }
});

app.post('/api/posts/:id/like', async (req, res) => {
  try {
    const { handle } = req.body;
    const post = await Post.findById(req.params.id);

    if (!post) return res.status(404).json({ error: "Post not found" });

    const likedBy = post.likedBy || [];
    const hasLiked = likedBy.includes(handle);
    if (hasLiked) {
      post.likedBy.pull(handle);
      post.likes = Math.max(0, post.likes - 1);
    } else {
      post.likedBy.push(handle);
      post.likes += 1;
    }

    await post.save();
    res.json({ success: true, likes: post.likes, likedBy: post.likedBy });
  } catch (err) {
    res.status(500).json({ error: "Failed to like post" });
  }
});

app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const comments = await Comment.find({ postId: req.params.id }).sort({ createdAt: 1 });
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

app.post('/api/posts/:id/comments', async (req, res) => {
  try {
    const { author, handle, content } = req.body;
    const user = await User.findOne({ username: handle });

    const newComment = new Comment({
      postId: req.params.id,
      author: author || "User",
      handle: handle || "@guest",
      avatarUrl: user ? user.avatarUrl : "https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png",
      content
    });

    await newComment.save();
    res.json({ success: true, comment: newComment });
  } catch (err) {
    res.status(500).json({ error: "Failed to post comment" });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.json({ users: [], posts: [] });

    const regex = new RegExp(query, 'i');
    const users = await User.find({ $or: [{ displayName: regex }, { username: regex }] }, '-password').limit(10);
    const posts = await Post.find({ $or: [{ content: regex }, { title: regex }, { handle: regex }] }).sort({ createdAt: -1 }).limit(20);

    res.json({ success: true, users, posts });
  } catch (err) {
    res.status(500).json({ error: "Search failed" });
  }
});

// --- ADMIN MANAGEMENT ROUTES ---

app.post('/api/admin/verify', async (req, res) => {
  try {
    let { handle, isVerified } = req.body;
    if (!handle.startsWith('@')) handle = `@${handle}`;

    await User.findOneAndUpdate({ username: handle }, { isVerified });
    await Post.updateMany({ handle }, { $set: { isVerified } });

    res.json({ success: true, message: `Updated ${handle} verification status to ${isVerified}` });
  } catch (err) {
    res.status(500).json({ error: "Failed to update verification status" });
  }
});

app.post('/api/admin/ban', async (req, res) => {
  try {
    let { handle, isBanned } = req.body;
    if (!handle.startsWith('@')) handle = `@${handle}`;

    const user = await User.findOneAndUpdate(
      { username: handle },
      { isBanned },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ 
      success: true, 
      message: `${handle} has been ${isBanned ? '🚫 BANNED' : '✅ UNBANNED'}.` 
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to update ban status" });
  }
});

app.post('/api/admin/delete-user', async (req, res) => {
  try {
    let { handle } = req.body;
    if (!handle.startsWith('@')) handle = `@${handle}`;

    const deletedUser = await User.findOneAndDelete({ username: handle });
    if (!deletedUser) return res.status(404).json({ error: "User not found" });

    await Post.deleteMany({ handle });
    await Comment.deleteMany({ handle });

    res.json({ 
      success: true, 
      message: `User ${handle} and all associated posts/comments have been deleted.` 
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user" });
  }
});

app.delete('/api/admin/posts/:id', async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    await Comment.deleteMany({ postId: req.params.id });
    res.json({ success: true, message: "Post deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete post" });
  }
});

app.get('/api/admin/user/:handle', async (req, res) => {
  try {
    let handle = req.params.handle;
    if (!handle.startsWith('@')) handle = `@${handle}`;

    const user = await User.findOne({ username: handle }, '-password');
    if (!user) return res.status(404).json({ error: "User not found" });

    const userPosts = await Post.find({ handle });
    const totalLikes = userPosts.reduce((acc, post) => acc + (post.likes || 0), 0);

    res.json({
      success: true,
      user: {
        displayName: user.displayName,
        username: user.username,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        isVerified: user.isVerified,
        isBanned: user.isBanned,
        followersCount: (user.followers || []).length,
        followersList: user.followers || [],
        followingCount: (user.following || []).length,
        followingList: user.following || [],
        totalPosts: userPosts.length,
        totalLikesReceived: totalLikes,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to inspect user" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
