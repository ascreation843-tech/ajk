import axios from 'axios';

const API_URL = 'http://localhost:3000'; // Assuming local dev
const TOKEN = 'YOUR_TEST_TOKEN'; // User would need to provide or I'd need to bypass auth for test

async function testGetOrder(id) {
  try {
    const response = await axios.get(`${API_URL}/orders/${id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    console.log('Order Details:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// testGetOrder('some-id');
