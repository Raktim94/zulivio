package com.nodedr.zulivio.ui

import androidx.compose.runtime.Composable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nodedr.zulivio.AppContainer

@Suppress("UNCHECKED_CAST")
@Composable
inline fun <reified VM : ViewModel> containerViewModel(c: AppContainer, key: String? = null, crossinline create: (AppContainer) -> VM): VM =
    viewModel(
        key = key,
        factory = object : ViewModelProvider.Factory {
            override fun <T : ViewModel> create(modelClass: Class<T>): T = create(c) as T
        },
    )
