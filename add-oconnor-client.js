/**
 * Script to add O'Connor client to agency workspace
 * Run this in the browser console when logged in as admin
 */

(async () => {
  // Import the database service
  const { createClient } = await import('./src/services/db.ts');
  
  // Add O'Connor Butcher client
  try {
    const clientId = await createClient({
      name: "O'Connor Butcher",
      businessType: "Butcher Shop & Meat Provider",
      createdAt: new Date().toISOString(),
      plan: 'growth' // Set appropriate plan
    });
    
    console.log('✅ O\'Connor client added successfully with ID:', clientId);
    alert('O\'Connor Butcher client has been added to your agency workspace!');
    
    // Refresh the page to see the new client
    window.location.reload();
  } catch (error) {
    console.error('❌ Failed to add O\'Connor client:', error);
    alert('Failed to add client. Check console for details.');
  }
})();
