const express = require('express');
const session = require('express-session');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = 3000;

// Discord OAuth2 Configuration
const DISCORD_CLIENT_ID = '1365022578015469578';
const DISCORD_CLIENT_SECRET = 'BDwjXiGXUl7jty8MpTptKfYEfJ5TpWKE';
const REDIRECT_URI = 'https://bioweb-six.vercel.app/auth/discord/callback';
const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Serve uploaded files
app.use('/data', express.static(path.join(__dirname, 'data')));

// Session configuration
app.use(session({
    secret: 'your-super-secret-session-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Paths
const DATA_DIR = path.join(__dirname, 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

// Ensure data directory exists
function ensureDirectories() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log('Created data directory');
    }
}
ensureDirectories();

// Helper: Read profiles from JSON file
function readProfiles() {
    try {
        if (fs.existsSync(PROFILES_FILE)) {
            const data = fs.readFileSync(PROFILES_FILE, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('Error reading profiles file:', error);
        return [];
    }
}

// Helper: Write profiles to JSON file
function writeProfiles(profiles) {
    try {
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
        console.log('Profiles saved successfully');
        return true;
    } catch (error) {
        console.error('Error writing profiles file:', error);
        return false;
    }
}

// Helper: Create user directory structure
function createUserDirectories(username, discordId) {
    const folderName = username || discordId;
    const userDir = path.join(DATA_DIR, folderName);
    const avatarDir = path.join(userDir, 'avatar');
    
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
        console.log(`Created user directory: ${userDir}`);
    }
    if (!fs.existsSync(avatarDir)) {
        fs.mkdirSync(avatarDir, { recursive: true });
        console.log(`Created avatar directory: ${avatarDir}`);
    }
    
    return { userDir, avatarDir };
}

// Helper: Get user avatar path
function getUserAvatarPath(username, discordId) {
    const folderName = username || discordId;
    const avatarDir = path.join(DATA_DIR, folderName, 'avatar');
    
    console.log(`Looking for avatar in: ${avatarDir}`);
    
    if (fs.existsSync(avatarDir)) {
        const files = fs.readdirSync(avatarDir);
        console.log(`Files in avatar directory: ${files.join(', ')}`);
        const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        if (imageFiles.length > 0) {
            const avatarPath = path.join('data', folderName, 'avatar', imageFiles[0]);
            console.log(`Found avatar: ${avatarPath}`);
            return avatarPath;
        }
    }
    console.log('No avatar found');
    return null;
}

// Helper: Delete old avatar files (except the new one)
function deleteOldAvatar(username, discordId, excludeFile = null) {
    const folderName = username || discordId;
    const avatarDir = path.join(DATA_DIR, folderName, 'avatar');
    
    console.log(`Checking for old avatars in: ${avatarDir}`);
    
    if (fs.existsSync(avatarDir)) {
        const files = fs.readdirSync(avatarDir);
        for (const file of files) {
            if (excludeFile && file === excludeFile) {
                console.log(`Keeping new avatar: ${file}`);
                continue;
            }
            const filePath = path.join(avatarDir, file);
            try {
                fs.unlinkSync(filePath);
                console.log(`Deleted old avatar: ${filePath}`);
            } catch (err) {
                console.error(`Error deleting old avatar: ${err.message}`);
            }
        }
    }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        try {
            const user = req.session.user;
            if (!user) {
                console.error('User not authenticated');
                return cb(new Error('User not authenticated'), null);
            }
            
            const profiles = readProfiles();
            const profile = profiles.find(p => p.discordId === user.discordId);
            if (!profile) {
                console.error('Profile not found for user:', user.discordId);
                return cb(new Error('Profile not found'), null);
            }
            
            const folderName = profile.username || user.discordId;
            const userDir = path.join(DATA_DIR, folderName);
            const avatarDir = path.join(userDir, 'avatar');
            
            if (!fs.existsSync(userDir)) {
                fs.mkdirSync(userDir, { recursive: true });
                console.log(`Created user directory: ${userDir}`);
            }
            if (!fs.existsSync(avatarDir)) {
                fs.mkdirSync(avatarDir, { recursive: true });
                console.log(`Created avatar directory: ${avatarDir}`);
            }
            
            console.log(`Saving avatar to: ${avatarDir}`);
            cb(null, avatarDir);
        } catch (error) {
            console.error('Error in multer destination:', error);
            cb(error, null);
        }
    },
    filename: function (req, file, cb) {
        try {
            const ext = path.extname(file.originalname);
            const filename = 'image' + ext;
            console.log(`Saving avatar as: ${filename}`);
            cb(null, filename);
        } catch (error) {
            console.error('Error in multer filename:', error);
            cb(error, null);
        }
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            console.log('File type accepted:', file.mimetype);
            cb(null, true);
        } else {
            console.error('File type rejected:', file.mimetype);
            cb(new Error('Only JPEG, PNG, GIF, and WEBP images are allowed'), false);
        }
    }
});

// Helper: Find or create user profile
function findOrCreateProfile(userData) {
    const profiles = readProfiles();
    const existing = profiles.find(p => p.discordId === userData.id);
    
    if (existing) {
        existing.username = userData.username;
        existing.globalName = userData.global_name || userData.username;
        existing.email = userData.email;
        existing.verified = userData.verified || false;
        existing.updatedAt = new Date().toISOString();
        writeProfiles(profiles);
        console.log('Updated existing profile for user:', userData.username);
        return { profile: existing, isNew: false };
    } else {
        createUserDirectories(userData.username, userData.id);
        
        const folderName = userData.username || userData.id;
        
        const newProfile = {
            discordId: userData.id,
            username: userData.username,
            globalName: userData.global_name || userData.username,
            mydata: `data/${folderName}/`,
            avatar: null,
            avatarDiscord: userData.avatar,
            email: userData.email,
            verified: userData.verified || false,
            customUrl: null,
            bio: '',
            twitter: '',
            github: '',
            instagram: '',
            youtube: '',
            linkedin: '',
            location: '',
            theme: {
                // Card settings
                cardColor: '#1a1a1a',
                glassEffect: false,
                cardTransparency: '0.95',
                cardBlur: '10px',
                borderRadius: '20px',

                // Sub Tab settings
                '3dparallaxfollow': false,
                subTabRadius: '12px',
                subTabBg: 'rgba(0,0,0,0.2)',
                subTabText: 'rgba(255,255,255,0.8)',
                subTabLabel: 'rgba(255,255,255,0.5)',
                // Hover colors
                detailHoverBg: 'rgba(255,255,255,0.08)',
                socialHoverBg: 'rgba(255,255,255,0.08)',
                twitterHover: 'rgba(29,161,242,0.7)',
                githubHover: 'rgba(51,51,51,0.7)',
                instagramHover: 'rgba(228,64,95,0.7)',
                youtubeHover: 'rgba(255,0,0,0.7)',
                linkedinHover: 'rgba(0,119,181,0.7)'
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        profiles.push(newProfile);
        writeProfiles(profiles);
        console.log('Created new profile for user:', userData.username);
        return { profile: newProfile, isNew: true };
    }
}

// Helper: Get profile by custom URL
function getProfileByCustomUrl(customUrl) {
    const profiles = readProfiles();
    return profiles.find(p => p.customUrl === customUrl);
}

// Helper: Check if custom URL is available
function isCustomUrlAvailable(customUrl, excludeDiscordId = null) {
    const profiles = readProfiles();
    return !profiles.some(p => 
        p.customUrl === customUrl && p.discordId !== excludeDiscordId
    );
}

// ===== THEME ROUTES =====

// Update theme settings
app.post('/update-theme', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { 
        cardColor, 
        cardTransparency, 
        cardBlur, 
        glassEffect, 
        borderRadius,
        '3dparallaxfollow': threeDParallaxFollow,

        subTabRadius,
        subTabBg,
        subTabText,
        subTabLabel,
        detailHoverBg,
        socialHoverBg,
        twitterHover,
        githubHover,
        instagramHover,
        youtubeHover,
        linkedinHover
    } = req.body;
    
    // Validate Card Color
    if (cardColor && !/^#?[0-9A-F]{6}$/i.test(cardColor) && !cardColor.startsWith('rgba')) {
        return res.status(400).json({ error: 'Invalid card color format. Use HEX (#RRGGBB) or RGBA' });
    }
    
    // Validate Transparency
    if (cardTransparency) {
        const opacity = parseFloat(cardTransparency);
        if (isNaN(opacity) || opacity < 0 || opacity > 1) {
            return res.status(400).json({ error: 'Transparency must be between 0 and 1' });
        }
    }
    
    // Validate Blur
    if (cardBlur) {
        const blurValue = parseFloat(cardBlur);
        if (isNaN(blurValue) || blurValue < 0) {
            return res.status(400).json({ error: 'Blur must be a positive number' });
        }
    }

    // Validate Glass Effect
    if (glassEffect !== undefined && glassEffect !== 'true' && glassEffect !== 'false' && typeof glassEffect !== 'boolean') {
        return res.status(400).json({ error: 'glassEffect must be a boolean (true/false)' });
    }

    // Validate Border Radius
    if (borderRadius) {
        const radiusValue = parseFloat(borderRadius);
        if (isNaN(radiusValue) || radiusValue < 0 || radiusValue > 50) {
            return res.status(400).json({ error: 'Border radius must be between 0 and 50' });
        }
    }

    // Validate 3D Parallax Follow
    if (threeDParallaxFollow !== undefined && threeDParallaxFollow !== 'true' && threeDParallaxFollow !== 'false' && typeof threeDParallaxFollow !== 'boolean') {
        return res.status(400).json({ error: '3D Parallax Follow must be a boolean (true/false)' });
    }

    // Validate Sub Tab Radius
    if (subTabRadius) {
        const radiusValue = parseFloat(subTabRadius);
        if (isNaN(radiusValue) || radiusValue < 0 || radiusValue > 30) {
            return res.status(400).json({ error: 'Sub Tab radius must be between 0 and 30' });
        }
    }

    // Validate Sub Tab Background
    if (subTabBg && !/^#?[0-9A-F]{6}$/i.test(subTabBg) && !subTabBg.startsWith('rgba')) {
        return res.status(400).json({ error: 'Invalid Sub Tab background color format' });
    }

    // Validate Sub Tab Text
    if (subTabText && !/^#?[0-9A-F]{6}$/i.test(subTabText) && !subTabText.startsWith('rgba')) {
        return res.status(400).json({ error: 'Invalid Sub Tab text color format' });
    }

    // Validate Sub Tab Label
    if (subTabLabel && !/^#?[0-9A-F]{6}$/i.test(subTabLabel) && !subTabLabel.startsWith('rgba')) {
        return res.status(400).json({ error: 'Invalid Sub Tab label color format' });
    }

    // Validate Hover Colors
    if (detailHoverBg && !/^#?[0-9A-F]{6}$/i.test(detailHoverBg) && !detailHoverBg.startsWith('rgba')) {
        return res.status(400).json({ error: 'Invalid detail hover background format' });
    }

    if (socialHoverBg && !/^#?[0-9A-F]{6}$/i.test(socialHoverBg) && !socialHoverBg.startsWith('rgba')) {
        return res.status(400).json({ error: 'Invalid social hover background format' });
    }

    if (twitterHover && !/^#?[0-9A-F]{6}$/i.test(twitterHover) && !twitterHover.startsWith('rgba')) {
        return res.status(400).json({ error: 'Invalid Twitter hover color format' });
    }

    if (githubHover && !/^#?[0-9A-F]{6}$/i.test(githubHover) && !githubHover.startsWith('rgba')) {
        return res.status(400).json({ error: 'Invalid GitHub hover color format' });
    }

    if (instagramHover && !/^#?[0-9A-F]{6}$/i.test(instagramHover) && !instagramHover.startsWith('rgba')) {
        return res.status(400).json({ error: 'Invalid Instagram hover color format' });
    }

    if (youtubeHover && !/^#?[0-9A-F]{6}$/i.test(youtubeHover) && !youtubeHover.startsWith('rgba')) {
        return res.status(400).json({ error: 'Invalid YouTube hover color format' });
    }

    if (linkedinHover && !/^#?[0-9A-F]{6}$/i.test(linkedinHover) && !linkedinHover.startsWith('rgba')) {
        return res.status(400).json({ error: 'Invalid LinkedIn hover color format' });
    }

    // Read profiles and find the user's profile
    const profiles = readProfiles();
    const profileIndex = profiles.findIndex(p => p.discordId === req.session.user.discordId);
    
    if (profileIndex === -1) {
        return res.status(404).json({ error: 'Profile not found' });
    }

    // Initialize theme object if it doesn't exist
    if (!profiles[profileIndex].theme) {
        profiles[profileIndex].theme = {};
    }

    // Update Card Settings
    if (cardColor) profiles[profileIndex].theme.cardColor = cardColor;
    if (cardTransparency) profiles[profileIndex].theme.cardTransparency = cardTransparency;
    if (cardBlur) profiles[profileIndex].theme.cardBlur = cardBlur;
    if (glassEffect !== undefined) {
        profiles[profileIndex].theme.glassEffect = glassEffect === 'true' || glassEffect === true;
    }
    if (borderRadius) profiles[profileIndex].theme.borderRadius = borderRadius;
    
    // Update 3D Parallax Follow
    if (threeDParallaxFollow !== undefined) {
        profiles[profileIndex].theme['3dparallaxfollow'] = threeDParallaxFollow === 'true' || threeDParallaxFollow === true;
    }
    

    // Update Sub Tab Settings
    if (subTabRadius) profiles[profileIndex].theme.subTabRadius = subTabRadius;
    if (subTabBg) profiles[profileIndex].theme.subTabBg = subTabBg;
    if (subTabText) profiles[profileIndex].theme.subTabText = subTabText;
    if (subTabLabel) profiles[profileIndex].theme.subTabLabel = subTabLabel;

    // Update Hover Colors
    if (detailHoverBg) profiles[profileIndex].theme.detailHoverBg = detailHoverBg;
    if (socialHoverBg) profiles[profileIndex].theme.socialHoverBg = socialHoverBg;
    if (twitterHover) profiles[profileIndex].theme.twitterHover = twitterHover;
    if (githubHover) profiles[profileIndex].theme.githubHover = githubHover;
    if (instagramHover) profiles[profileIndex].theme.instagramHover = instagramHover;
    if (youtubeHover) profiles[profileIndex].theme.youtubeHover = youtubeHover;
    if (linkedinHover) profiles[profileIndex].theme.linkedinHover = linkedinHover;

    // Update timestamp
    profiles[profileIndex].updatedAt = new Date().toISOString();
    
    // Save profiles
    writeProfiles(profiles);

    // Update session with new theme
    req.session.user.theme = profiles[profileIndex].theme;

    // Return success response
    res.json({ 
        success: true, 
        theme: profiles[profileIndex].theme,
        message: 'Theme updated successfully'
    });
});

// Get theme settings for a profile
app.get('/api/theme/:customUrl', (req, res) => {
    const profile = getProfileByCustomUrl(req.params.customUrl);
    if (!profile) {
        return res.status(404).json({ error: 'Profile not found' });
    }

    const theme = profile.theme || {
        cardColor: '#1a1a1a',
        glassEffect: true,
        cardTransparency: '0.95',
        cardBlur: '10px',
        borderRadius: '20px',
        '3dparallaxfollow': true,
  
        subTabRadius: '12px',
        subTabBg: 'rgba(0,0,0,0.2)',
        subTabText: 'rgba(255,255,255,0.8)',
        subTabLabel: 'rgba(255,255,255,0.5)',
        detailHoverBg: 'rgba(255,255,255,0.08)',
        socialHoverBg: 'rgba(255,255,255,0.08)',
        twitterHover: 'rgba(29,161,242,0.7)',
        githubHover: 'rgba(51,51,51,0.7)',
        instagramHover: 'rgba(228,64,95,0.7)',
        youtubeHover: 'rgba(255,0,0,0.7)',
        linkedinHover: 'rgba(0,119,181,0.7)'
    };

    res.json({ theme });
});

// ===== MAIN ROUTES =====

// Home page
app.get('/', (req, res) => {
    const user = req.session.user || null;
    res.render('home', { 
        user: user,
        DISCORD_CLIENT_ID: DISCORD_CLIENT_ID,
        REDIRECT_URI: REDIRECT_URI
    });
});

// Start Discord OAuth flow
app.get('/auth/discord', (req, res) => {
    const authUrl = `${DISCORD_API_BASE}/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20email`;
    res.redirect(authUrl);
});

// Discord OAuth callback
app.get('/auth/discord/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('No authorization code provided');
    }

    try {
        const tokenResponse = await axios.post(`${DISCORD_API_BASE}/oauth2/token`, 
            new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const { access_token } = tokenResponse.data;

        const userResponse = await axios.get(`${DISCORD_API_BASE}/users/@me`, {
            headers: {
                Authorization: `Bearer ${access_token}`
            }
        });

        const userData = userResponse.data;

        const { profile, isNew } = findOrCreateProfile(userData);
        
        const avatarPath = getUserAvatarPath(profile.username, profile.discordId);
        
        req.session.user = {
            discordId: profile.discordId,
            username: profile.username,
            globalName: profile.globalName,
            mydata: profile.mydata,
            avatar: avatarPath,
            avatarDiscord: profile.avatarDiscord,
            email: profile.email,
            customUrl: profile.customUrl,
            isNew: isNew,
            access_token: access_token,
            theme: profile.theme
        };

        if (isNew) {
            res.redirect('/onboarding');
        } else {
            res.redirect('/dashboard');
        }
    } catch (error) {
        console.error('Discord OAuth error:', error.response?.data || error.message);
        res.status(500).send('Authentication failed. Please try again.');
    }
});

// Onboarding - Set custom URL for new users
app.get('/onboarding', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    
    if (req.session.user.customUrl) {
        return res.redirect('/dashboard');
    }
    
    res.render('onboarding', { 
        user: req.session.user,
        error: null
    });
});

// Onboarding - Save custom URL
app.post('/onboarding', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    
    const { customUrl } = req.body;
    
    if (!customUrl || customUrl.trim() === '') {
        return res.render('onboarding', { 
            user: req.session.user,
            error: 'Please enter a custom URL'
        });
    }
    
    const urlPattern = /^[a-zA-Z0-9_-]+$/;
    if (!urlPattern.test(customUrl)) {
        return res.render('onboarding', { 
            user: req.session.user,
            error: 'URL can only contain letters, numbers, dashes, and underscores'
        });
    }
    
    if (!isCustomUrlAvailable(customUrl, req.session.user.discordId)) {
        return res.render('onboarding', { 
            user: req.session.user,
            error: 'This URL is already taken. Please choose another one.'
        });
    }
    
    const profiles = readProfiles();
    const profileIndex = profiles.findIndex(p => p.discordId === req.session.user.discordId);
    
    if (profileIndex !== -1) {
        profiles[profileIndex].customUrl = customUrl;
        profiles[profileIndex].updatedAt = new Date().toISOString();
        writeProfiles(profiles);
        
        req.session.user.customUrl = customUrl;
        req.session.user.isNew = false;
        
        res.redirect('/dashboard');
    } else {
        res.status(404).send('Profile not found');
    }
});

// Dashboard - shows user profile (requires auth)
app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    
    const profiles = readProfiles();
    const userProfile = profiles.find(p => p.discordId === req.session.user.discordId);
    
    if (!userProfile) {
        req.session.destroy();
        return res.redirect('/');
    }
    
    const avatarPath = getUserAvatarPath(userProfile.username, userProfile.discordId);
    if (avatarPath) {
        req.session.user.avatar = avatarPath;
        userProfile.avatar = avatarPath;
    }
    
    res.render('dashboard', { 
        user: req.session.user,
        profile: userProfile
    });
});

// Update profile (bio, social links, etc.)
app.post('/update-profile', (req, res) => {
    upload.single('avatar')(req, res, function(err) {
        if (err instanceof multer.MulterError) {
            console.error('Multer error:', err);
            if (err.code === 'FILE_TOO_LARGE') {
                return res.status(400).send('File too large. Max size is 5MB.');
            }
            return res.status(400).send('Upload error: ' + err.message);
        } else if (err) {
            console.error('Unknown upload error:', err);
            return res.status(400).send('Upload error: ' + err.message);
        }
        
        processProfileUpdate(req, res);
    });
});

function processProfileUpdate(req, res) {
    if (!req.session.user) {
        return res.redirect('/');
    }
    
    console.log('Processing profile update for user:', req.session.user.username);
    console.log('Request body:', req.body);
    console.log('Request file:', req.file);
    
    const { bio, twitter, github, instagram, youtube, linkedin, location } = req.body;
    
    const profiles = readProfiles();
    const profileIndex = profiles.findIndex(p => p.discordId === req.session.user.discordId);
    
    if (profileIndex === -1) {
        return res.status(404).send('Profile not found');
    }
    
    const profile = profiles[profileIndex];
    
    if (req.file) {
        console.log('Avatar file uploaded:');
        console.log('- Original name:', req.file.originalname);
        console.log('- Saved as:', req.file.filename);
        console.log('- Path:', req.file.path);
        console.log('- Destination:', req.file.destination);
        
        deleteOldAvatar(profile.username, profile.discordId, req.file.filename);
        
        const avatarPath = getUserAvatarPath(profile.username, profile.discordId);
        if (avatarPath) {
            profile.avatar = avatarPath;
            req.session.user.avatar = avatarPath;
            console.log('Avatar path saved to profile:', avatarPath);
        } else {
            const folderName = profile.username || profile.discordId;
            const manualPath = path.join('data', folderName, 'avatar', req.file.filename);
            profile.avatar = manualPath;
            req.session.user.avatar = manualPath;
            console.log('Avatar path manually set to:', manualPath);
        }
    }
    
    profile.bio = bio || '';
    profile.twitter = twitter || '';
    profile.github = github || '';
    profile.instagram = instagram || '';
    profile.youtube = youtube || '';
    profile.linkedin = linkedin || '';
    profile.location = location || '';
    profile.updatedAt = new Date().toISOString();
    
    writeProfiles(profiles);
    console.log('Profile updated for user:', profile.username);
    
    res.redirect('/dashboard?saved=true');
}

// Public profile page - /:customUrl
app.get('/:customUrl', (req, res) => {
    const { customUrl } = req.params;
    
    const systemRoutes = ['auth', 'dashboard', 'onboarding', 'api', 'logout', 'styles', 'scripts', 'favicon.ico', 'data'];
    if (systemRoutes.includes(customUrl)) {
        return res.status(404).send('Page not found');
    }
    
    const profile = getProfileByCustomUrl(customUrl);
    
    if (!profile) {
        return res.status(404).render('404', { 
            customUrl: customUrl,
            user: req.session.user || null
        });
    }
    
    const avatarPath = getUserAvatarPath(profile.username, profile.discordId);
    if (avatarPath) {
        profile.avatar = avatarPath;
    }
    
    res.render('profile', { 
        profile: profile,
        user: req.session.user || null
    });
});

// API endpoint to get all profiles
app.get('/api/profiles', (req, res) => {
    const profiles = readProfiles();
    res.json(profiles);
});

// API endpoint to get a specific profile by custom URL
app.get('/api/profiles/:customUrl', (req, res) => {
    const profile = getProfileByCustomUrl(req.params.customUrl);
    if (profile) {
        res.json(profile);
    } else {
        res.status(404).json({ error: 'Profile not found' });
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            res.clearCookie('connect.sid');
            return res.redirect('/');
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            res.clearCookie('connect.sid');
            return res.redirect('/');
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).send('Something went wrong!');
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔑 Discord OAuth enabled with client ID: ${DISCORD_CLIENT_ID}`);
    console.log(`🔄 Redirect URI: ${REDIRECT_URI}`);
    console.log(`📁 Data directory: ${DATA_DIR}`);
    console.log(`📝 Example profile URL: http://localhost:${PORT}/kiko\n`);
});