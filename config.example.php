<<<<<<< HEAD
<?php
// Database configuration file
// Copy this file and rename it to 'config.php', then update the values below

return [
    'database' => [
        'host' => 'localhost',
        'dbname' => 'productvisualizerdb',
        'username' => 'root',        // Change this to your database username
        'password' => '',            // Change this to your database password
        'charset' => 'utf8mb4'
    ],
    'upload' => [
        'sticker_dir' => 'uploads/stickers/',
        'max_file_size' => 5 * 1024 * 1024,  // 5MB
        'allowed_extensions' => ['jpg', 'jpeg', 'png', 'gif']
    ]
];
?>

=======
<?php
// Database configuration file
// Copy this file and rename it to 'config.php', then update the values below

return [
    'database' => [
        'host' => 'localhost',
        'dbname' => 'productvisualizerdb',
        'username' => 'root',        // database username
        'password' => '',            //  database password
        'charset' => 'utf8mb4'
    ],
    'upload' => [
        'sticker_dir' => 'uploads/stickers/',
        'max_file_size' => 5 * 1024 * 1024,  // 5MB
        'allowed_extensions' => ['jpg', 'jpeg', 'png', 'gif']
    ]
];
?>

>>>>>>> 1d2ee17 (file structure of index.html)
