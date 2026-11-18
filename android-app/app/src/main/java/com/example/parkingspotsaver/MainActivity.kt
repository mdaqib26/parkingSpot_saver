package com.example.parkingspotsaver

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

class MainActivity : AppCompatActivity() {

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private val prefs by lazy { getSharedPreferences("parking_spot", Context.MODE_PRIVATE) }
    private val handler = Handler(Looper.getMainLooper())

    private lateinit var tvSavedStatus: TextView
    private lateinit var tvDistance: TextView
    private lateinit var etNote: EditText
    private lateinit var btnNavigate: Button

    private val requestPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            saveMyParkingSpot()
        } else {
            Toast.makeText(this, "GPS permission required", Toast.LENGTH_SHORT).show()
        }
    }

    private val ticker = object : Runnable {
        override fun run() {
            refreshSavedSpotUI()
            handler.postDelayed(this, 5000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        tvSavedStatus = findViewById(R.id.tvSavedStatus)
        tvDistance = findViewById(R.id.tvDistance)
        etNote = findViewById(R.id.etNote)
        btnNavigate = findViewById(R.id.btnNavigate)

        findViewById<Button>(R.id.btnSaveSpot).setOnClickListener {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
            ) {
                saveMyParkingSpot()
            } else {
                requestPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        }

        btnNavigate.setOnClickListener {
            val lat = prefs.getFloat("lat", Float.NaN)
            val lng = prefs.getFloat("lng", Float.NaN)
            if (lat.isNaN() || lng.isNaN()) return@setOnClickListener

            val uri = Uri.parse("geo:$lat,$lng?q=$lat,$lng(My+Parked+Car)")
            val mapsIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                setPackage("com.google.android.apps.maps")
            }
            try {
                startActivity(mapsIntent)
            } catch (_: Exception) {
                startActivity(Intent(Intent.ACTION_VIEW, uri))
            }
        }
    }

    override fun onResume() {
        super.onResume()
        handler.post(ticker)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(ticker)
    }

    private fun saveMyParkingSpot() {
        fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
            .addOnSuccessListener { location ->
                if (location != null) {
                    prefs.edit()
                        .putFloat("lat", location.latitude.toFloat())
                        .putFloat("lng", location.longitude.toFloat())
                        .putLong("savedAt", System.currentTimeMillis())
                        .putString("note", etNote.text.toString())
                        .apply()
                    Toast.makeText(this, "Parking spot saved!", Toast.LENGTH_SHORT).show()
                    refreshSavedSpotUI()
                } else {
                    Toast.makeText(this, "Turn on GPS and try again", Toast.LENGTH_SHORT).show()
                }
            }
    }

    private fun refreshSavedSpotUI() {
        val lat = prefs.getFloat("lat", Float.NaN)
        val lng = prefs.getFloat("lng", Float.NaN)
        val savedAt = prefs.getLong("savedAt", 0L)
        if (lat.isNaN() || lng.isNaN() || savedAt == 0L) {
            tvSavedStatus.text = "No parking spot saved yet"
            tvDistance.text = "--"
            btnNavigate.isEnabled = false
            return
        }

        btnNavigate.isEnabled = true
        val minsAgo = ((System.currentTimeMillis() - savedAt) / 60000).coerceAtLeast(0)
        val note = prefs.getString("note", "") ?: ""
        tvSavedStatus.text = "Saved ${minsAgo}m ago" + if (note.isNotBlank()) " • $note" else ""

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED
        ) {
            fusedLocationClient.lastLocation.addOnSuccessListener { current ->
                if (current != null) {
                    val target = Location("saved").apply {
                        latitude = lat.toDouble()
                        longitude = lng.toDouble()
                    }
                    val meters = current.distanceTo(target).toInt()
                    tvDistance.text = "$meters meters away"
                }
            }
        }
    }
}
