const API_URL = "https://osctok-social-app.onrender.com";

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            // Save token or user info and redirect to the feed
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            
            alert('Login successful!');
            window.location.href = 'index.html'; // Redirect to feed/home page
        } else {
            alert(data.message || 'Login failed.');
        }
    } catch (error) {
        console.error('Error during login:', error);
        alert('An error occurred. Please check your connection.');
    }
});
